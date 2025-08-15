-- Test data for ERP master data validation
-- Run this to populate test data for all list-matching fields

-- GL Accounts
INSERT INTO erp_master_data (client_id, data_type, code, name, description, is_active) VALUES
('00000000-0000-0000-0000-000000000000', 'gl_account', '4000', 'Sales Revenue', 'Revenue from product sales', true),
('00000000-0000-0000-0000-000000000000', 'gl_account', '5000', 'Cost of Goods Sold', 'Direct costs of products sold', true),
('00000000-0000-0000-0000-000000000000', 'gl_account', '6000', 'Operating Expenses', 'General operating expenses', true),
('00000000-0000-0000-0000-000000000000', 'gl_account', '6100', 'Marketing Expenses', 'Marketing and advertising costs', true),
('00000000-0000-0000-0000-000000000000', 'gl_account', '6200', 'Office Supplies', 'Office supplies and materials', true),
('00000000-0000-0000-0000-000000000000', 'gl_account', '7000', 'IT Expenses', 'Information technology costs', true)
ON CONFLICT (client_id, data_type, code) DO NOTHING;

-- Cost Centers
INSERT INTO erp_master_data (client_id, data_type, code, name, description, is_active) VALUES
('00000000-0000-0000-0000-000000000000', 'cost_center', 'CC100', 'Sales Department', 'Sales team cost center', true),
('00000000-0000-0000-0000-000000000000', 'cost_center', 'CC200', 'Marketing Department', 'Marketing team cost center', true),
('00000000-0000-0000-0000-000000000000', 'cost_center', 'CC300', 'IT Department', 'Information Technology', true),
('00000000-0000-0000-0000-000000000000', 'cost_center', 'CC400', 'Operations', 'Operations department', true),
('00000000-0000-0000-0000-000000000000', 'cost_center', 'CC500', 'Human Resources', 'HR department', true)
ON CONFLICT (client_id, data_type, code) DO NOTHING;

-- Tax Codes
INSERT INTO erp_master_data (client_id, data_type, code, name, description, is_active) VALUES
('00000000-0000-0000-0000-000000000000', 'tax_code', 'V0', 'Tax Exempt', '0% tax rate', true),
('00000000-0000-0000-0000-000000000000', 'tax_code', 'V1', 'Standard Rate', 'Standard tax rate', true),
('00000000-0000-0000-0000-000000000000', 'tax_code', 'V2', 'Reduced Rate', 'Reduced tax rate', true),
('00000000-0000-0000-0000-000000000000', 'tax_code', 'I1', 'Input Tax Standard', 'Standard input tax', true)
ON CONFLICT (client_id, data_type, code) DO NOTHING;

-- Company Codes
INSERT INTO erp_master_data (client_id, data_type, code, name, description, is_active) VALUES
('00000000-0000-0000-0000-000000000000', 'company_code', '1000', 'Fluxity Corp', 'Main company', true),
('00000000-0000-0000-0000-000000000000', 'company_code', '2000', 'Fluxity UK Ltd', 'UK subsidiary', true),
('00000000-0000-0000-0000-000000000000', 'company_code', '3000', 'Fluxity GmbH', 'German subsidiary', true)
ON CONFLICT (client_id, data_type, code) DO NOTHING;

-- Document Types
INSERT INTO erp_master_data (client_id, data_type, code, name, description, is_active) VALUES
('00000000-0000-0000-0000-000000000000', 'document_type', 'RE', 'Vendor Invoice', 'Standard vendor invoice', true),
('00000000-0000-0000-0000-000000000000', 'document_type', 'KR', 'Vendor Credit', 'Vendor credit memo', true),
('00000000-0000-0000-0000-000000000000', 'document_type', 'KG', 'Vendor Payment', 'Vendor payment document', true)
ON CONFLICT (client_id, data_type, code) DO NOTHING;

-- Profit Centers
INSERT INTO erp_master_data (client_id, data_type, code, name, description, is_active) VALUES
('00000000-0000-0000-0000-000000000000', 'profit_center', 'PC1000', 'Product Sales', 'Product sales profit center', true),
('00000000-0000-0000-0000-000000000000', 'profit_center', 'PC2000', 'Services', 'Services profit center', true),
('00000000-0000-0000-0000-000000000000', 'profit_center', 'PC3000', 'Consulting', 'Consulting profit center', true)
ON CONFLICT (client_id, data_type, code) DO NOTHING;

-- More vendors for testing fuzzy matching
INSERT INTO erp_master_data (client_id, data_type, code, name, description, is_active) VALUES
('00000000-0000-0000-0000-000000000000', 'vendor', 'AMZN001', 'Amazon Web Services', 'Cloud services provider', true),
('00000000-0000-0000-0000-000000000000', 'vendor', 'MSFT001', 'Microsoft Corporation', 'Software and cloud services', true),
('00000000-0000-0000-0000-000000000000', 'vendor', 'GOOG001', 'Google Cloud Platform', 'Cloud infrastructure', true),
('00000000-0000-0000-0000-000000000000', 'vendor', 'SLACK01', 'Slack Technologies', 'Communication platform', true),
('00000000-0000-0000-0000-000000000000', 'vendor', 'ZOOM001', 'Zoom Video Communications', 'Video conferencing', true),
('00000000-0000-0000-0000-000000000000', 'vendor', 'OFFIC01', 'Office Depot', 'Office supplies', true),
('00000000-0000-0000-0000-000000000000', 'vendor', 'STAPL01', 'Staples Inc', 'Office supplies and furniture', true)
ON CONFLICT (client_id, data_type, code) DO NOTHING;