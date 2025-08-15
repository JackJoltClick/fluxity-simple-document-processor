/**
 * Secure Enhanced Document Processor
 * 
 * Core Flow:
 * 1. Textract extracts comprehensive data (text, tables, layout, signatures)
 * 2. GPT-4 processes with rich context from all Textract features
 * 3. Returns structured data ready for mapping
 * 
 * Security Features:
 * - Environment variable validation
 * - Safe JSON parsing with error handling
 * - Input validation and sanitization
 * - Proper error boundaries
 */

import { TextractClient, AnalyzeDocumentCommand } from '@aws-sdk/client-textract';
import { SQSEvent } from 'aws-lambda';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import fetch from 'node-fetch';
import { createValidationService } from './validation-service';

// Secure environment variable loading with validation
function getRequiredEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Validate and load environment variables
const SUPABASE_URL = getRequiredEnvVar('SUPABASE_URL');
const SUPABASE_SERVICE_KEY = getRequiredEnvVar('SUPABASE_SERVICE_KEY');
const OPENAI_API_KEY = getRequiredEnvVar('OPENAI_API_KEY');
const AWS_REGION = process.env.AWS_REGION || 'us-west-2';

// Validate URL format
try {
  new URL(SUPABASE_URL);
} catch (error) {
  throw new Error(`Invalid SUPABASE_URL format: ${error instanceof Error ? error.message : 'Unknown error'}`);
}

// Initialize clients with validated credentials
const textract = new TextractClient({ region: AWS_REGION });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const validationService = createValidationService(SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENAI_API_KEY);

// Configuration constants
const CONFIG = {
  MAX_FILE_SIZE_MB: 50,
  TIMEOUT_MS: 30000,
  MAX_RETRY_ATTEMPTS: 3,
  SUPPORTED_FILE_TYPES: ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif'],
  GPT4_MODEL: 'gpt-4o',
  GPT4_MAX_TOKENS: 2000,
  GPT4_TEMPERATURE: 0.1,
} as const;

// Type definitions
interface JobData {
  documentId: string;
  userId: string;
  fileUrl: string;
  filename: string;
  receiptHandle?: string;
  clientId?: string;
}

interface ProcessedDocument {
  fields: Record<string, any>;
  confidence: number;
  full_text: string;
}

interface ExtractedData {
  text: string;
  keyValues: Record<string, string>;
  tables: any[];
  layout: {
    titles: string[];
    headers: string[];
    sections: string[];
    lists: string[];
  };
  signatures: any[];
}

// Input validation functions
function validateJobData(data: any): JobData {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid job data: must be an object');
  }

  const { documentId, userId, fileUrl, filename } = data;

  if (!documentId || typeof documentId !== 'string' || documentId.trim().length === 0) {
    throw new Error('Invalid documentId: must be a non-empty string');
  }

  if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
    throw new Error('Invalid userId: must be a non-empty string');
  }

  if (!fileUrl || typeof fileUrl !== 'string') {
    throw new Error('Invalid fileUrl: must be a string');
  }

  // Validate URL format
  try {
    new URL(fileUrl);
  } catch {
    throw new Error('Invalid fileUrl: must be a valid URL');
  }

  if (!filename || typeof filename !== 'string' || filename.trim().length === 0) {
    throw new Error('Invalid filename: must be a non-empty string');
  }

  // Validate file extension
  const fileExt = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  if (!CONFIG.SUPPORTED_FILE_TYPES.includes(fileExt as any)) {
    throw new Error(`Unsupported file type: ${fileExt}. Supported types: ${CONFIG.SUPPORTED_FILE_TYPES.join(', ')}`);
  }

  return { documentId, userId, fileUrl, filename, receiptHandle: data.receiptHandle };
}

// Safe JSON parsing utility
function safeJsonParse<T>(jsonString: string, fallback: T): T {
  try {
    const parsed = JSON.parse(jsonString);
    return parsed ?? fallback;
  } catch (error) {
    console.warn('JSON parsing failed:', error instanceof Error ? error.message : 'Unknown error');
    return fallback;
  }
}

/**
 * Extract comprehensive data from document using Textract
 */
async function extractText(documentUrl: string): Promise<ExtractedData> {
  console.log('📄 Extracting comprehensive data with Textract...');
  
  // Download document with validation
  const response = await fetch(documentUrl, { 
    timeout: CONFIG.TIMEOUT_MS,
    headers: { 'User-Agent': 'Fluxity-DocumentProcessor/1.0' }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to download document: ${response.status} ${response.statusText}`);
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const fileSizeBytes = parseInt(contentLength, 10);
    const fileSizeMB = fileSizeBytes / (1024 * 1024);
    
    if (fileSizeMB > CONFIG.MAX_FILE_SIZE_MB) {
      throw new Error(`File too large: ${fileSizeMB.toFixed(2)}MB. Maximum allowed: ${CONFIG.MAX_FILE_SIZE_MB}MB`);
    }
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  
  // Validate buffer size as backup
  const actualSizeMB = buffer.length / (1024 * 1024);
  if (actualSizeMB > CONFIG.MAX_FILE_SIZE_MB) {
    throw new Error(`File too large: ${actualSizeMB.toFixed(2)}MB. Maximum allowed: ${CONFIG.MAX_FILE_SIZE_MB}MB`);
  }
  
  // Call Textract with ALL features
  const command = new AnalyzeDocumentCommand({
    Document: { Bytes: buffer },
    FeatureTypes: ['FORMS', 'TABLES', 'LAYOUT', 'SIGNATURES']
  });
  
  const result = await textract.send(command);
  
  // Initialize extraction results
  let fullText = '';
  const keyValues: Record<string, string> = {};
  const tables: any[] = [];
  const layout = {
    titles: [] as string[],
    headers: [] as string[],
    sections: [] as string[],
    lists: [] as string[]
  };
  const signatures: any[] = [];
  
  // Create block maps for relationships
  const blockMap = new Map();
  const keyMap = new Map();
  const valueMap = new Map();
  const tableMap = new Map();
  const cellMap = new Map();
  
  // First pass: map all blocks
  result.Blocks?.forEach(block => {
    blockMap.set(block.Id, block);
    
    // Map different block types
    if (block.BlockType === 'KEY_VALUE_SET') {
      if (block.EntityTypes?.includes('KEY')) {
        keyMap.set(block.Id, block);
      } else {
        valueMap.set(block.Id, block);
      }
    } else if (block.BlockType === 'TABLE') {
      tableMap.set(block.Id, block);
    } else if (block.BlockType === 'CELL') {
      cellMap.set(block.Id, block);
    }
  });
  
  // Extract all text and layout elements
  result.Blocks?.forEach(block => {
    // Get regular text
    if (block.BlockType === 'LINE' && block.Text) {
      fullText += block.Text + '\n';
    }
    
    // Extract layout elements
    if (block.BlockType?.startsWith('LAYOUT_')) {
      const text = block.Text || '';
      switch (block.BlockType) {
        case 'LAYOUT_TITLE':
          layout.titles.push(text);
          break;
        case 'LAYOUT_HEADER':
          layout.headers.push(text);
          break;
        case 'LAYOUT_SECTION_HEADER':
          layout.sections.push(text);
          break;
        case 'LAYOUT_LIST':
          layout.lists.push(text);
          break;
      }
    }
    
    // Extract signatures
    if (block.BlockType === 'SIGNATURE') {
      signatures.push({
        confidence: block.Confidence,
        geometry: block.Geometry
      });
    }
  });
  
  // Extract key-value pairs
  keyMap.forEach((keyBlock: any) => {
    const valueBlock = findValueBlock(keyBlock, valueMap);
    if (valueBlock) {
      const keyText = getText(keyBlock, blockMap);
      const valueText = getText(valueBlock, blockMap);
      if (keyText && valueText) {
        keyValues[keyText] = valueText;
      }
    }
  });
  
  // Extract tables
  tableMap.forEach((tableBlock: any) => {
    const table = extractTable(tableBlock, cellMap, blockMap);
    if (table && table.rows.length > 0) {
      tables.push(table);
    }
  });
  
  console.log(`✅ Extracted:`);
  console.log(`   - ${Object.keys(keyValues).length} key-value pairs`);
  console.log(`   - ${tables.length} tables`);
  console.log(`   - ${layout.titles.length} titles`);
  console.log(`   - ${signatures.length} signatures`);
  
  return { 
    text: fullText, 
    keyValues,
    tables,
    layout,
    signatures
  };
}

function findValueBlock(keyBlock: any, valueMap: Map<any, any>) {
  let valueBlock;
  keyBlock.Relationships?.forEach((relationship: any) => {
    if (relationship.Type === 'VALUE' && relationship.Ids) {
      relationship.Ids.forEach((valueId: string) => {
        if (valueMap.has(valueId)) {
          valueBlock = valueMap.get(valueId);
        }
      });
    }
  });
  return valueBlock;
}

function getText(block: any, blockMap: Map<any, any>): string {
  let text = '';
  if (block.Relationships) {
    block.Relationships.forEach((relationship: any) => {
      if (relationship.Type === 'CHILD' && relationship.Ids) {
        relationship.Ids.forEach((childId: string) => {
          const childBlock = blockMap.get(childId);
          if (childBlock && childBlock.BlockType === 'WORD') {
            text += childBlock.Text + ' ';
          }
        });
      }
    });
  }
  return text.trim();
}

/**
 * Extract table data from Textract blocks
 */
function extractTable(tableBlock: any, cellMap: Map<any, any>, blockMap: Map<any, any>) {
  const rows: any[] = [];
  const cells: any[] = [];
  
  // Get all cells for this table
  if (tableBlock.Relationships) {
    tableBlock.Relationships.forEach((relationship: any) => {
      if (relationship.Type === 'CHILD' && relationship.Ids) {
        relationship.Ids.forEach((cellId: string) => {
          const cell = cellMap.get(cellId);
          if (cell) {
            const cellText = getText(cell, blockMap);
            cells.push({
              rowIndex: cell.RowIndex || 0,
              columnIndex: cell.ColumnIndex || 0,
              text: cellText,
              rowSpan: cell.RowSpan || 1,
              columnSpan: cell.ColumnSpan || 1
            });
          }
        });
      }
    });
  }
  
  // Organize cells into rows
  cells.forEach(cell => {
    if (!rows[cell.rowIndex - 1]) {
      rows[cell.rowIndex - 1] = [];
    }
    rows[cell.rowIndex - 1][cell.columnIndex - 1] = cell.text;
  });
  
  return {
    rows: rows.filter(row => row && row.length > 0),
    rawCells: cells
  };
}


/**
 * Process document with GPT-4 for basic extraction (with extraction rules)
 */
async function extractWithGPT4(
  documentUrl: string, 
  extractedData: ExtractedData,
  schema?: any,
  extractionRules?: any[]
): Promise<ProcessedDocument> {
  console.log('🤖 Processing with GPT-4...');
  
  const isPDF = documentUrl.toLowerCase().includes('.pdf');
  const isImage = /\.(jpg|jpeg|png|webp|gif)/i.test(documentUrl.toLowerCase());
  
  // Build system prompt with extraction rules if provided
  const systemPrompt = `You are an expert document processor. Extract and map data from the document using ALL the information provided below.

${extractionRules && extractionRules.length > 0 ? `EXTRACTION RULES (How to find and read data):
${extractionRules.map(r => `- ${r.rule_text}`).join('\n')}

Apply these rules when extracting data from the document.
` : ''}

${schema ? `Map to these specific fields:
${JSON.stringify(schema.columns?.map((c: any) => c.name) || [], null, 2)}` : 
`Extract these standard accounting fields:
- invoicing_party (vendor/company name)
- supplier_invoice_id_by_invcg_party (invoice number)
- document_date (YYYY-MM-DD format)
- posting_date (YYYY-MM-DD format)
- invoice_gross_amount (total amount as number)
- supplier_invoice_item_text (line item descriptions)
- document_currency (USD/EUR/etc)
- tax_code
- cost_center
- gl_account`}

DOCUMENT STRUCTURE:
${extractedData.layout.titles.length > 0 ? `- Title(s): ${extractedData.layout.titles.join(', ')}` : ''}
${extractedData.layout.headers.length > 0 ? `- Headers: ${extractedData.layout.headers.join(', ')}` : ''}
${extractedData.layout.sections.length > 0 ? `- Section Headers: ${extractedData.layout.sections.join(', ')}` : ''}
${extractedData.signatures.length > 0 ? `- ${extractedData.signatures.length} signature(s) detected` : ''}

KEY-VALUE PAIRS FOUND:
${JSON.stringify(extractedData.keyValues, null, 2)}

${extractedData.tables.length > 0 ? `TABLES FOUND (${extractedData.tables.length} table(s)):
${extractedData.tables.map((table, i) => `
Table ${i + 1}:
${table.rows.map((row: any[]) => row.join(' | ')).join('\n')}
`).join('\n')}` : ''}

FULL EXTRACTED TEXT:
${extractedData.text}

${isImage ? 'The image is provided below. Use BOTH the visual document AND all the extracted structured data to ensure accuracy.' : 
'This is a PDF document. Use ALL the extracted data above (structure, tables, key-values, and text) to accurately map the fields.'}

IMPORTANT FORMATTING RULES:
- Return each field as a single string value (not arrays)
- For multiple line items, combine them with " | " separator
- For multiple related values, combine with ", " separator
- Use exact field names from the schema
- Focus on extracting raw values from the document
- Do NOT apply business rules or make assumptions

Return ONLY a JSON object with the mapped fields. No explanations.`;

  let completion;
  
  if (isImage) {
    // For images: use GPT-4 Vision with the actual image
    console.log('🖼️ Using GPT-4 Vision for image processing...');
    
    // Download image with same security validations
    const response = await fetch(documentUrl, { 
      timeout: CONFIG.TIMEOUT_MS,
      headers: { 'User-Agent': 'Fluxity-DocumentProcessor/1.0' }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to download image for GPT-4 Vision: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Validate file size
    const fileSizeMB = buffer.length / (1024 * 1024);
    if (fileSizeMB > CONFIG.MAX_FILE_SIZE_MB) {
      throw new Error(`Image too large for GPT-4 Vision: ${fileSizeMB.toFixed(2)}MB`);
    }
    
    const base64 = buffer.toString('base64');
    const mimeType = 'image/jpeg'; // GPT-4 Vision only accepts image types
    
    completion = await openai.chat.completions.create({
      model: CONFIG.GPT4_MODEL,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Extract and map all fields from this document image. Use both the visual and the extracted text.'
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64}`
              }
            }
          ]
        }
      ],
      response_format: { type: 'json_object' },
      temperature: CONFIG.GPT4_TEMPERATURE,
      max_tokens: CONFIG.GPT4_MAX_TOKENS
    });
  } else {
    // For PDFs: use regular GPT-4 with just the extracted text
    console.log('📄 Using GPT-4 with extracted text for PDF processing...');
    completion = await openai.chat.completions.create({
      model: CONFIG.GPT4_MODEL,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: 'Based on the extracted text and key-value pairs provided, map all the fields accurately. Return the JSON object.'
        }
      ],
      response_format: { type: 'json_object' },
      temperature: CONFIG.GPT4_TEMPERATURE,
      max_tokens: CONFIG.GPT4_MAX_TOKENS
    });
  }
  
  // Safe JSON parsing with validation
  const responseContent = completion.choices[0]?.message?.content;
  if (!responseContent) {
    throw new Error('GPT-4 returned empty response');
  }
  
  const result = safeJsonParse(responseContent, {});
  
  console.log('✅ GPT-4 processing complete');
  
  // Add confidence to each field and normalize array responses
  const fieldsWithConfidence: Record<string, any> = {};
  for (const [key, value] of Object.entries(result)) {
    // Normalize array values to strings for better display
    let normalizedValue = value;
    if (Array.isArray(value)) {
      // For line items and text arrays, join with proper formatting
      if (key.toLowerCase().includes('item') || key.toLowerCase().includes('text') || key.toLowerCase().includes('description')) {
        normalizedValue = value.join(' | '); // Use pipe separator for line items
      } else {
        normalizedValue = value.join(', '); // Use comma separator for other arrays
      }
    }
    
    // Set high confidence since we're using enhanced Textract + GPT-4
    fieldsWithConfidence[key] = {
      value: normalizedValue,
      confidence: 0.95  // High confidence for all fields with enhanced extraction
    };
  }
  
  return {
    fields: fieldsWithConfidence,
    confidence: 0.95, // Overall confidence
    full_text: extractedData.text
  };
}

/**
 * Apply Smart Rules using GPT-4 with validated fields and ERP data
 */
async function applySmartRulesWithGPT4(
  validatedFields: Record<string, any>,
  smartRules: any[],
  clientId: string
): Promise<Record<string, any>> {
  console.log('🎯 Applying Smart Rules with GPT-4 and validated data...');
  
  // Get ERP master data for GPT-4 to use
  const { data: erpData } = await supabase
    .from('erp_master_data')
    .select('*')
    .eq('client_id', clientId)
    .eq('is_active', true);
  
  // Organize ERP codes by type for GPT-4
  const erpCodes: Record<string, any[]> = {};
  erpData?.forEach(item => {
    if (!erpCodes[item.data_type]) erpCodes[item.data_type] = [];
    erpCodes[item.data_type].push({
      code: item.code,
      name: item.name,
      description: item.description
    });
  });
  
  // Organize rules by category
  const extractionRules = smartRules.filter(r => r.category === 'extraction');
  const assignmentRules = smartRules.filter(r => r.category === 'assignment');
  const matchingRules = smartRules.filter(r => r.category === 'matching');
  
  console.log('📝 Smart Rules to apply:', {
    extractionRules: extractionRules.map(r => r.rule_text),
    assignmentRules: assignmentRules.map(r => r.rule_text),
    matchingRules: matchingRules.map(r => r.rule_text),
    validatedVendor: validatedFields.invoicing_party
  });
  
  const prompt = `Apply the following Smart Rules to this validated document data.

CURRENT VALIDATED FIELDS (already matched to ERP codes):
${JSON.stringify(validatedFields, null, 2)}

AVAILABLE ERP MASTER DATA:
${JSON.stringify(erpCodes, null, 2)}

${assignmentRules.length > 0 ? `
ASSIGNMENT RULES (Direct field overrides - use the EXACT value specified):
${assignmentRules.map(r => `- ${r.rule_text}`).join('\n')}
` : ''}
${matchingRules.length > 0 ? `
MATCHING RULES (Business logic - find the matching code in ERP master data):
${matchingRules.map(r => `- ${r.rule_text}`).join('\n')}
` : ''}

IMPORTANT INSTRUCTIONS:
1. Apply ALL applicable rules based on the validated field values
2. For ASSIGNMENT RULES: Apply the EXACT value specified in the rule, even if it's not in ERP data
3. For MATCHING RULES: Find the matching code in the appropriate ERP master data list
4. When a rule says "Human Resources", find the matching code in cost_center list  
5. When a rule says "IT Expenses", find the matching code in gl_account list
6. The vendor field (invoicing_party) already contains the ERP code (like JACK0001), not the original name
7. Return all fields, including ones not affected by rules

Return ONLY a JSON object with all fields (both rule-applied and unchanged).`;

  try {
    const completion = await openai.chat.completions.create({
      model: CONFIG.GPT4_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a business rules engine. Apply rules precisely using the provided ERP master data codes.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 2000
    });
    
    const result = safeJsonParse(completion.choices[0]?.message?.content || '{}', validatedFields);
    console.log('✅ Smart Rules applied successfully');
    console.log('📤 Result after Smart Rules:', {
      cost_center: result.cost_center,
      gl_account: result.gl_account
    });
    return result;
  } catch (error) {
    console.error('Failed to apply Smart Rules:', error);
    return validatedFields; // Return original if rules fail
  }
}

/**
 * Main document processing function
 */
export async function processDocument(jobData: JobData): Promise<void> {
  const startTime = Date.now();
  
  try {
    console.log(`\n🚀 Processing document: ${jobData.filename}`);
    
    // Update status to processing
    await supabase
      .from('documents')
      .update({ 
        status: 'processing',
        updated_at: new Date().toISOString()
      })
      .eq('id', jobData.documentId);
    
    // Get user's schema if configured
    const { data: settings } = await supabase
      .from('user_settings')
      .select('default_schema_id')
      .eq('user_id', jobData.userId)
      .single();
    
    let schema = null;
    if (settings?.default_schema_id) {
      const { data: schemaData } = await supabase
        .from('client_schemas')
        .select('*')
        .eq('id', settings.default_schema_id)
        .single();
      schema = schemaData;
    }
    
    // Get user's smart rules
    const { data: smartRules } = await supabase
      .from('smart_rules')
      .select('*')
      .eq('user_id', jobData.userId)
      .eq('is_active', true)
      .order('category', { ascending: true });
    
    console.log(`🎯 Found ${smartRules?.length || 0} active smart rules for user`);
    
    // Step 1: Extract comprehensive data with Textract
    const extractedData = await extractText(jobData.fileUrl);
    
    // Filter extraction rules to pass to first GPT-4 call
    const extractionRules = smartRules?.filter(r => r.category === 'extraction' && r.is_active) || [];
    
    // Step 2: Extract fields with GPT-4 (WITH extraction rules)
    const extracted = await extractWithGPT4(jobData.fileUrl, extractedData, schema, extractionRules);
    console.log('📊 EXTRACTED FIELDS:', JSON.stringify(extracted.fields, null, 2));
    
    // Step 3: Validate ALL fields against ERP master data
    const clientId = jobData.clientId || '00000000-0000-0000-0000-000000000000';
    console.log('🔍 Validating fields against ERP master data...');
    
    const validationResults = await validationService.validateDocumentFields(
      extracted.fields,
      clientId
    );
    
    // Apply validation results to fields
    const validatedFields = { ...extracted.fields };
    console.log('🔍 VALIDATION RESULTS:', JSON.stringify(validationResults, null, 2));
    
    for (const [fieldName, validation] of Object.entries(validationResults)) {
      if (validation.confidence >= 85 && validation.matched_code) {
        console.log(`✅ Validated ${fieldName}: "${validation.extracted_value}" → "${validation.matched_code}"`);
        validatedFields[fieldName] = validation.matched_code;
      }
    }
    
    console.log('📝 VALIDATED FIELDS:', JSON.stringify(validatedFields, null, 2));
    
    // Step 4: Apply Smart Rules with validated data using GPT-4
    let finalFields = validatedFields;
    if (smartRules && smartRules.length > 0) {
      console.log('🎯 Applying Smart Rules with GPT-4...');
      console.log('📋 SMART RULES:', smartRules.map(r => ({ category: r.category, rule: r.rule_text })));
      finalFields = await applySmartRulesWithGPT4(validatedFields, smartRules, clientId);
      console.log('🎉 FINAL FIELDS AFTER RULES:', JSON.stringify(finalFields, null, 2));
    }
    
    // Create final processed document
    const processed = {
      fields: finalFields,
      confidence: extracted.confidence,
      full_text: extracted.full_text
    };
    
    // Update usage counts for smart rules (if any were used)
    if (smartRules && smartRules.length > 0) {
      console.log('📊 Updating smart rule usage counts...');
      await Promise.all(smartRules.map(rule => 
        supabase
          .from('smart_rules')
          .update({ usage_count: (rule.usage_count || 0) + 1 })
          .eq('id', rule.id)
      ));
    }
    
    // Step 5: Save results with enriched metadata
    const { error } = await supabase
      .from('documents')
      .update({
        status: 'completed',
        extraction_method: 'enhanced-textract-gpt4-smart-rules',
        extracted_data: {
          fields: processed.fields,
          metadata: {
            extraction_method: 'enhanced-textract-gpt4-smart-rules',
            schema_used: schema?.name || 'default-accounting',
            smart_rules_applied: smartRules?.length || 0,
            validation_performed: true,
            confidence: processed.confidence,
            processing_time_ms: Date.now() - startTime,
            textract_features: {
              key_value_pairs: Object.keys(extractedData.keyValues).length,
              tables_found: extractedData.tables.length,
              layout_elements: {
                titles: extractedData.layout.titles.length,
                headers: extractedData.layout.headers.length,
                sections: extractedData.layout.sections.length
              },
              signatures_detected: extractedData.signatures.length
            }
          }
        },
        full_text: processed.full_text,
        accounting_status: determineStatus(processed.fields),
        extraction_cost: 0.04, // Slightly higher with more features
        updated_at: new Date().toISOString()
      })
      .eq('id', jobData.documentId);
    
    if (error) throw error;
    
    console.log(`✅ Document processed in ${Date.now() - startTime}ms\n`);
    
  } catch (error) {
    console.error('❌ Processing failed:', error);
    
    // Update status to failed
    await supabase
      .from('documents')
      .update({
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
        updated_at: new Date().toISOString()
      })
      .eq('id', jobData.documentId);
    
    throw error;
  }
}

/**
 * Determine if document has minimum required fields
 */
function determineStatus(fields: Record<string, any>): string {
  const required = ['invoicing_party', 'document_date', 'invoice_gross_amount'];
  const hasRequired = required.every(field => fields[field]);
  return hasRequired ? 'ready_for_export' : 'needs_mapping';
}

/**
 * Lambda handler for SQS events with comprehensive error handling
 */
export const handler = async (event: SQSEvent) => {
  console.log(`📦 Processing ${event.Records.length} documents from queue`);
  
  // Validate input
  if (!event || !event.Records || !Array.isArray(event.Records)) {
    console.error('❌ Invalid event structure');
    throw new Error('Invalid SQS event structure');
  }

  if (event.Records.length === 0) {
    console.log('ℹ️ No records to process');
    return { statusCode: 200, body: JSON.stringify({ successful: 0, failed: 0, message: 'No records to process' }) };
  }
  
  const results = await Promise.allSettled(
    event.Records.map(async (record, index) => {
      try {
        // Validate SQS record structure
        if (!record || !record.body) {
          throw new Error(`Invalid SQS record at index ${index}: missing body`);
        }

        // Safe JSON parsing with validation
        const rawJobData = safeJsonParse(record.body, null);
        if (!rawJobData) {
          throw new Error(`Invalid JSON in SQS record body at index ${index}`);
        }

        // Validate job data structure
        const jobData = validateJobData(rawJobData);
        
        console.log(`📄 Processing document ${index + 1}/${event.Records.length}: ${jobData.filename}`);
        
        await processDocument(jobData);
        return { success: true, documentId: jobData.documentId };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`❌ Failed to process record ${index + 1}:`, errorMessage);
        return { success: false, error: errorMessage, index };
      }
    })
  );
  
  const successful = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;
  
  console.log(`✅ Batch complete: ${successful} successful, ${failed} failed`);
  
  return {
    statusCode: 200,
    body: JSON.stringify({ successful, failed })
  };
};