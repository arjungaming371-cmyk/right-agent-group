-- Remove the AI kill-switch row. form_configs itself is shared
-- (custom_roles_config + whatsapp_loan_form live there) and is NOT dropped.

DELETE FROM form_configs WHERE id = 'ai_pause';
