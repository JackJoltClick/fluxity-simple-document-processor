#!/bin/bash

# Deploy Simple Lambda Function
set -e

echo "🚀 Deploying Simple Document Processor Lambda..."

# Configuration
AWS_REGION="us-west-2"
FUNCTION_NAME="fluxity-simple-processor"
ROLE_ARN="arn:aws:iam::454449944373:role/FluxityLambdaRole"
TIMEOUT=60
MEMORY=512

# Build
echo "📦 Building TypeScript..."
npm run build

# Package
echo "📦 Creating deployment package..."
cd dist
cp ../package*.json .
npm ci --production
zip -r ../deployment.zip . -q
cd ..

# Check if function exists
if aws lambda get-function --function-name $FUNCTION_NAME --region $AWS_REGION &>/dev/null; then
    echo "📝 Updating existing function..."
    aws lambda update-function-code \
        --function-name $FUNCTION_NAME \
        --zip-file fileb://deployment.zip \
        --region $AWS_REGION
    
    # Update configuration including runtime
    aws lambda update-function-configuration \
        --function-name $FUNCTION_NAME \
        --runtime nodejs20.x \
        --timeout $TIMEOUT \
        --memory-size $MEMORY \
        --environment Variables="{
            SUPABASE_URL=$SUPABASE_URL,
            SUPABASE_SERVICE_KEY=$SUPABASE_SERVICE_KEY,
            OPENAI_API_KEY=$OPENAI_API_KEY
        }" \
        --region $AWS_REGION
else
    echo "🆕 Creating new function..."
    aws lambda create-function \
        --function-name $FUNCTION_NAME \
        --runtime nodejs20.x \
        --role $ROLE_ARN \
        --handler index.handler \
        --timeout $TIMEOUT \
        --memory-size $MEMORY \
        --zip-file fileb://deployment.zip \
        --environment Variables="{
            SUPABASE_URL=$SUPABASE_URL,
            SUPABASE_SERVICE_KEY=$SUPABASE_SERVICE_KEY,
            OPENAI_API_KEY=$OPENAI_API_KEY
        }" \
        --region $AWS_REGION
    
    # Add SQS trigger (using same queue)
    echo "🔗 Adding SQS trigger..."
    aws lambda create-event-source-mapping \
        --function-name $FUNCTION_NAME \
        --event-source-arn arn:aws:sqs:us-west-2:454449944373:fluxity-document-processing \
        --batch-size 1 \
        --region $AWS_REGION
fi

echo "✅ Deployment complete!"
echo "📊 Function: $FUNCTION_NAME"
echo "🌍 Region: $AWS_REGION"