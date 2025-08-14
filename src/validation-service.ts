/**
 * ERP Field Validation Service
 * ============================
 * 
 * This service validates extracted document fields against ERP master data.
 * 
 * CURRENT STATE (Development):
 * - Uses hardcoded test data in Supabase erp_master_data table
 * - Client ID: '00000000-0000-0000-0000-000000000000' (test client)
 * 
 * PRODUCTION READY:
 * - Replace fetchMasterData() with real ERP API calls (SAP, Oracle, NetSuite, etc.)
 * - Use actual client IDs from document metadata
 * - Cache ERP data in Redis/memory for performance
 * 
 * HOW IT WORKS:
 * 1. Extracts vendor name: "Jacks Foods"
 * 2. Fuzzy matches against ERP vendor list
 * 3. Returns top matches with confidence scores
 * 4. GPT-4 selects best match if ambiguous
 * 5. Auto-accepts >85% confidence, flags <85% for review
 * 
 * SUPPORTED ERP SYSTEMS (when implemented):
 * - SAP (via REST API or RFC)
 * - Oracle ERP Cloud (via REST API)
 * - NetSuite (via SuiteTalk API)
 * - Microsoft Dynamics (via OData API)
 * - QuickBooks (via REST API)
 * 
 * Just swap the data source - everything else stays the same!
 */

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

// Field types that require list matching
export const LIST_MATCH_FIELDS = {
  company_code: { maxLength: 4, description: 'Company Code' },
  transaction_type: { maxLength: 1, description: 'Transaction Type (1=Invoice, 2=Credit)' },
  invoicing_party: { maxLength: 10, description: 'Vendor/Invoicing Party' },
  document_type: { maxLength: 2, description: 'Document Type' },
  gl_account: { maxLength: 10, description: 'GL Account' },
  debit_credit: { maxLength: 1, description: 'Debit/Credit (S=Debit, H=Credit)' },
  tax_code: { maxLength: 2, description: 'Tax Code' },
  tax_jurisdiction: { maxLength: 15, description: 'Tax Jurisdiction' },
  assignment: { maxLength: 18, description: 'Assignment Reference' },
  cost_center: { maxLength: 10, description: 'Cost Center' },
  profit_center: { maxLength: 10, description: 'Profit Center' },
  order_number: { maxLength: 12, description: 'Order Number' },
  wbs_element: { maxLength: 24, description: 'WBS Element' }
};

interface MasterDataItem {
  code: string;
  name: string;
  description?: string;
}

interface ValidationResult {
  field: string;
  extracted_value: string;
  matched_code: string | null;
  matched_name: string | null;
  confidence: number;
  status: 'exact' | 'fuzzy_high' | 'fuzzy_medium' | 'fuzzy_low' | 'no_match';
  alternatives: Array<{
    code: string;
    name: string;
    score: number;
  }>;
}

export class ValidationService {
  private supabase: ReturnType<typeof createClient>;
  private openai: OpenAI;
  private rapidFuzz: any;

  constructor(
    supabaseUrl: string,
    supabaseKey: string,
    openaiKey: string
  ) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.openai = new OpenAI({ apiKey: openaiKey });
    
    // Dynamically import rapidfuzz-js for fuzzy matching
    // In Lambda, we'll use the Python version via a subprocess
    this.initializeFuzzyMatcher();
  }

  private async initializeFuzzyMatcher() {
    try {
      // For Node.js environment, we'll use a simple Levenshtein distance
      // In production Lambda, use Python's rapidfuzz via subprocess
      this.rapidFuzz = this.simpleFuzzyMatch;
    } catch (error) {
      console.log('Using simple fuzzy matcher');
      this.rapidFuzz = this.simpleFuzzyMatch;
    }
  }

  // Simple fuzzy matching implementation for testing
  private simpleFuzzyMatch(query: string, choices: string[], limit: number = 20): Array<[string, number]> {
    const results = choices.map(choice => {
      const score = this.calculateSimilarity(query.toLowerCase(), choice.toLowerCase());
      return [choice, score] as [string, number];
    });
    
    return results
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
  }

  // Calculate similarity score (0-100)
  private calculateSimilarity(s1: string, s2: string): number {
    // Remove common suffixes for better matching
    const cleanS1 = this.cleanCompanyName(s1);
    const cleanS2 = this.cleanCompanyName(s2);
    
    // If cleaned versions match exactly, high score
    if (cleanS1 === cleanS2) return 95;
    
    // Calculate Levenshtein distance ratio
    const maxLen = Math.max(s1.length, s2.length);
    if (maxLen === 0) return 100;
    
    const distance = this.levenshteinDistance(cleanS1, cleanS2);
    const ratio = ((maxLen - distance) / maxLen) * 100;
    
    // Boost score if one string contains the other
    if (s1.includes(s2) || s2.includes(s1)) {
      return Math.min(ratio + 15, 95);
    }
    
    return ratio;
  }

  // Clean company names for better matching
  private cleanCompanyName(name: string): string {
    return name
      .replace(/\b(inc|incorporated|corp|corporation|llc|ltd|limited|co|company|plc|gmbh|sa|ag|bv|nv)\b/gi, '')
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Calculate Levenshtein distance
  private levenshteinDistance(s1: string, s2: string): number {
    const m = s1.length;
    const n = s2.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (s1[i - 1] === s2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
      }
    }
    
    return dp[m][n];
  }

  // Fetch master data from Supabase
  async fetchMasterData(clientId: string, dataType: string): Promise<MasterDataItem[]> {
    /**
     * IMPORTANT: FUTURE API INTEGRATION POINT
     * ========================================
     * Currently fetches from Supabase erp_master_data table (hardcoded test data)
     * 
     * TO SWITCH TO REAL ERP API:
     * 1. Add client's ERP credentials to environment/secrets
     * 2. Replace this function body with API call:
     * 
     * Example SAP Integration:
     * ```
     * const sapClient = new SAPClient(process.env.SAP_URL, process.env.SAP_KEY);
     * return await sapClient.getMasterData(dataType);
     * ```
     * 
     * Example Oracle Integration:  
     * ```
     * const oracleAPI = new OracleERP(clientConfig);
     * return await oracleAPI.fetchVendors(); // or GL accounts, cost centers, etc.
     * ```
     * 
     * The return format should remain the same:
     * Array<{ code: string, name: string, description?: string }>
     * 
     * This allows seamless switching between test and production data
     * without changing any other code.
     */
    
    const { data, error } = await this.supabase
      .from('erp_master_data')
      .select('code, name, description')
      .eq('client_id', clientId)
      .eq('data_type', dataType)
      .eq('is_active', true);

    if (error) {
      console.error(`Error fetching ${dataType} master data:`, error);
      return [];
    }

    return data || [];
  }

  // Validate a single field against master data
  async validateField(
    extractedValue: string | null,
    fieldName: string,
    clientId: string,
    documentContext?: any
  ): Promise<ValidationResult> {
    if (!extractedValue) {
      return {
        field: fieldName,
        extracted_value: '',
        matched_code: null,
        matched_name: null,
        confidence: 0,
        status: 'no_match',
        alternatives: []
      };
    }

    // Map field names to data types
    const dataTypeMap: Record<string, string> = {
      invoicing_party: 'vendor',
      supplier_name: 'vendor',
      vendor_name: 'vendor',
      gl_account: 'gl_account',
      cost_center: 'cost_center',
      company_code: 'company_code',
      document_type: 'document_type',
      tax_code: 'tax_code',
      profit_center: 'profit_center',
      transaction_type: 'transaction_type',
      debit_credit: 'debit_credit'
    };

    const dataType = dataTypeMap[fieldName] || fieldName;
    const masterData = await this.fetchMasterData(clientId, dataType);

    if (masterData.length === 0) {
      return {
        field: fieldName,
        extracted_value: extractedValue,
        matched_code: null,
        matched_name: null,
        confidence: 0,
        status: 'no_match',
        alternatives: []
      };
    }

    // Check for exact match first
    const exactMatch = masterData.find(item => 
      item.code.toLowerCase() === extractedValue.toLowerCase() ||
      item.name.toLowerCase() === extractedValue.toLowerCase()
    );

    if (exactMatch) {
      return {
        field: fieldName,
        extracted_value: extractedValue,
        matched_code: exactMatch.code,
        matched_name: exactMatch.name,
        confidence: 100,
        status: 'exact',
        alternatives: []
      };
    }

    // Fuzzy match against names
    const choices = masterData.map(item => item.name);
    const fuzzyMatches = this.rapidFuzz(extractedValue, choices, 20);

    // Create alternatives array
    const alternatives = fuzzyMatches.map(([name, score]) => {
      const item = masterData.find(i => i.name === name)!;
      return {
        code: item.code,
        name: item.name,
        score: Math.round(score)
      };
    });

    // If top match is good enough, use it
    if (alternatives.length > 0 && alternatives[0].score > 85) {
      return {
        field: fieldName,
        extracted_value: extractedValue,
        matched_code: alternatives[0].code,
        matched_name: alternatives[0].name,
        confidence: alternatives[0].score,
        status: alternatives[0].score > 90 ? 'fuzzy_high' : 'fuzzy_medium',
        alternatives: alternatives.slice(1, 6)
      };
    }

    // For medium confidence matches, use GPT-4 to pick the best
    if (alternatives.length > 0 && alternatives[0].score > 60) {
      const gptSelection = await this.selectBestMatchWithGPT(
        extractedValue,
        alternatives.slice(0, 10),
        fieldName,
        documentContext
      );

      if (gptSelection) {
        return {
          field: fieldName,
          extracted_value: extractedValue,
          matched_code: gptSelection.code,
          matched_name: gptSelection.name,
          confidence: gptSelection.confidence,
          status: gptSelection.confidence > 75 ? 'fuzzy_medium' : 'fuzzy_low',
          alternatives: alternatives.filter(a => a.code !== gptSelection.code).slice(0, 5)
        };
      }
    }

    // No good match found
    return {
      field: fieldName,
      extracted_value: extractedValue,
      matched_code: alternatives[0]?.code || null,
      matched_name: alternatives[0]?.name || null,
      confidence: alternatives[0]?.score || 0,
      status: 'no_match',
      alternatives: alternatives.slice(0, 5)
    };
  }

  // Use GPT-4 to select the best match from fuzzy results
  private async selectBestMatchWithGPT(
    extractedValue: string,
    candidates: Array<{ code: string; name: string; score: number }>,
    fieldName: string,
    documentContext?: any
  ): Promise<{ code: string; name: string; confidence: number } | null> {
    try {
      const prompt = `
        You are validating extracted invoice data against a company's master data.
        
        Field: ${fieldName}
        Extracted Value: "${extractedValue}"
        
        Document Context:
        ${documentContext ? JSON.stringify(documentContext, null, 2) : 'No additional context'}
        
        Possible Matches (with fuzzy match scores):
        ${candidates.map((c, i) => `${i + 1}. "${c.name}" (Code: ${c.code}) - Score: ${c.score}%`).join('\n')}
        
        Select the best match based on:
        1. Semantic meaning and business context
        2. Common abbreviations and variations
        3. Industry standards
        
        Respond with JSON only:
        {
          "selected_index": <1-based index of best match, or 0 if none are good>,
          "confidence": <0-100 confidence in the selection>,
          "reasoning": "<brief explanation>"
        }
      `;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 200,
        response_format: { type: 'json_object' }
      });

      const result = JSON.parse(response.choices[0].message.content || '{}');
      
      if (result.selected_index > 0 && result.selected_index <= candidates.length) {
        const selected = candidates[result.selected_index - 1];
        return {
          code: selected.code,
          name: selected.name,
          confidence: result.confidence || selected.score
        };
      }
    } catch (error) {
      console.error('GPT-4 selection error:', error);
    }

    return null;
  }

  // Validate all fields in a document
  async validateDocumentFields(
    extractedFields: Record<string, any>,
    clientId: string
  ): Promise<Record<string, ValidationResult>> {
    const results: Record<string, ValidationResult> = {};
    
    // Get document context for GPT-4
    const documentContext = {
      vendor: extractedFields.invoicing_party || extractedFields.vendor_name,
      amount: extractedFields.invoice_gross_amount,
      date: extractedFields.document_date,
      description: extractedFields.document_header_text
    };

    // Validate each list-dependent field
    for (const fieldName of Object.keys(LIST_MATCH_FIELDS)) {
      if (extractedFields[fieldName]) {
        results[fieldName] = await this.validateField(
          extractedFields[fieldName],
          fieldName,
          clientId,
          documentContext
        );
      }
    }

    return results;
  }

  // Save validation results to database
  async saveValidationResults(
    documentId: string,
    validationResults: Record<string, ValidationResult>
  ): Promise<void> {
    const records = Object.values(validationResults).map(result => ({
      document_id: documentId,
      field_name: result.field,
      extracted_value: result.extracted_value,
      matched_code: result.matched_code,
      matched_name: result.matched_name,
      confidence: result.confidence,
      validation_status: result.status,
      alternative_matches: result.alternatives
    }));

    const { error } = await this.supabase
      .from('field_validations')
      .upsert(records, { onConflict: 'document_id,field_name' });

    if (error) {
      console.error('Error saving validation results:', error);
    }
  }
}

// Export a factory function
export function createValidationService(
  supabaseUrl: string,
  supabaseKey: string,
  openaiKey: string
): ValidationService {
  return new ValidationService(supabaseUrl, supabaseKey, openaiKey);
}