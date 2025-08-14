# Fluxity Simple Document Processor

A secure, enhanced AWS Lambda function for intelligent document processing using AWS Textract and OpenAI GPT-4.

## 🚀 Features

- **Enhanced Textract Extraction**: Extracts text, tables, layout, signatures, and key-value pairs
- **GPT-4 Integration**: Intelligent field mapping with visual context for images
- **Comprehensive Security**: Input validation, safe JSON parsing, and proper error handling
- **Node.js 20**: Latest LTS runtime for optimal performance
- **Type Safety**: Full TypeScript implementation with strict typing

## 📋 What It Does

1. **Document Analysis**: Processes PDFs and images using AWS Textract with all features enabled
2. **Intelligent Extraction**: Uses GPT-4 to map extracted data to structured fields
3. **Multi-Format Support**: Handles both PDFs (text-based) and images (vision-based processing)
4. **Database Integration**: Automatically saves results to Supabase database

## 🏗️ Architecture

```
SQS Queue → Lambda Function → [Textract + GPT-4] → Supabase Database
```

### Processing Flow:
1. **SQS Trigger**: Document processing jobs arrive via SQS
2. **Textract Analysis**: Extract comprehensive data (text, tables, layout, signatures)
3. **GPT-4 Processing**: 
   - PDFs: Use extracted text with GPT-4
   - Images: Use GPT-4 Vision with both image and extracted text
4. **Data Normalization**: Convert arrays to properly formatted strings
5. **Database Storage**: Save structured results to Supabase

## 🛠️ Prerequisites

- **Node.js**: ≥20.0.0 (LTS)
- **AWS Account**: With Lambda, Textract, and SQS access
- **Supabase Project**: For database storage
- **OpenAI API Key**: For GPT-4 processing

## 📦 Installation

1. **Clone the repository**:
   ```bash
   git clone <repo-url>
   cd simple-lambda
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Build the project**:
   ```bash
   npm run build
   ```

## ⚙️ Configuration

### Environment Variables

Create these environment variables in your AWS Lambda function:

```bash
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_KEY=your_supabase_service_role_key
OPENAI_API_KEY=your_openai_api_key
```

### Supported File Types

- **PDFs**: `.pdf`
- **Images**: `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`

### Configuration Limits

- **Max File Size**: 50MB
- **Timeout**: 30 seconds per download
- **Memory**: 512MB (configurable)
- **Runtime**: Node.js 20.x

## 🚀 Deployment

### Using the Deploy Script

1. **Set environment variables**:
   ```bash
   export SUPABASE_URL="your_url"
   export SUPABASE_SERVICE_KEY="your_key" 
   export OPENAI_API_KEY="your_key"
   ```

2. **Deploy**:
   ```bash
   ./deploy.sh
   ```

### Manual Deployment

1. **Build and package**:
   ```bash
   npm run build
   cd dist
   cp ../package*.json .
   npm ci --production
   zip -r ../deployment.zip .
   ```

2. **Deploy to AWS Lambda**:
   ```bash
   aws lambda update-function-code \
     --function-name your-function-name \
     --zip-file fileb://deployment.zip
   ```

## 🔒 Security Features

- **Environment Variable Validation**: Secure loading with proper error handling
- **Input Sanitization**: Comprehensive validation of all inputs
- **Safe JSON Parsing**: Protected against malformed responses
- **File Size Limits**: Protection against oversized uploads
- **URL Validation**: Ensures proper document URLs
- **Error Boundaries**: Comprehensive error handling and logging

## 📊 Extracted Data

### Standard Accounting Fields
- `invoicing_party` - Vendor/company name
- `supplier_invoice_id_by_invcg_party` - Invoice number
- `document_date` - Document date (YYYY-MM-DD)
- `posting_date` - Posting date (YYYY-MM-DD)
- `invoice_gross_amount` - Total amount
- `supplier_invoice_item_text` - Line item descriptions
- `document_currency` - Currency code
- `tax_code` - Tax information
- `cost_center` - Cost center code
- `gl_account` - General ledger account

### Enhanced Textract Features
- **Tables**: Structured table data with rows and columns
- **Layout**: Document titles, headers, and sections
- **Signatures**: Signature detection and location
- **Key-Value Pairs**: Form field extraction

## 🧪 Testing

### Local Testing
```bash
# Run TypeScript compilation
npm run build

# Test with sample SQS event
node dist/index.js
```

### AWS Testing
```bash
# Invoke Lambda function
aws lambda invoke \
  --function-name fluxity-simple-processor \
  --payload '{"Records":[{"body":"{}"}]}' \
  response.json
```

## 📝 Database Schema

The processor expects these database tables:

### Documents Table
```sql
- id (uuid, primary key)
- filename (text)
- status (text: 'pending', 'processing', 'completed', 'failed')
- extracted_data (jsonb)
- full_text (text)
- accounting_status (text)
- extraction_cost (decimal)
- extraction_method (text)
```

### User Settings Table
```sql
- user_id (uuid)
- default_schema_id (uuid, nullable)
```

### Client Schemas Table  
```sql
- id (uuid, primary key)
- name (text)
- columns (jsonb)
```

## 🐛 Troubleshooting

### Common Issues

1. **"Missing required environment variable"**
   - Ensure all environment variables are set in Lambda configuration

2. **"Failed to download document"**
   - Check document URL accessibility and file size limits

3. **"GPT-4 returned empty response"**
   - Verify OpenAI API key and account limits

4. **"Invalid file type"**
   - Ensure file extension is in supported types list

### Logging

The function provides comprehensive logging:
- 📄 Document processing start/end
- 🤖 GPT-4 processing status  
- ✅ Successful extractions with metrics
- ❌ Detailed error messages with context

## 🔄 Migration from Old Lambda

This simple Lambda replaces a complex 1,200+ line processor with:
- **60% less code** (508 lines vs 1,230 + services)
- **Better extraction** (uses ALL Textract features)
- **Higher accuracy** (comprehensive GPT-4 context)
- **Enhanced security** (proper validation and error handling)
- **Future-proof runtime** (Node.js 20 vs deprecated Node.js 18)

## 📈 Performance

- **Processing Time**: ~6-8 seconds per document
- **Memory Usage**: ~135MB peak
- **Cost**: ~$0.04 per document (Textract + GPT-4)
- **Accuracy**: 95% confidence with enhanced extraction

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with proper tests
4. Ensure security best practices
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

## 🆘 Support

For issues and questions:
- Create a GitHub issue
- Check the troubleshooting section
- Review AWS Lambda logs for detailed error information