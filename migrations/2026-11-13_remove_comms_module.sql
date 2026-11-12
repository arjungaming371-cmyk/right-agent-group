-- Remove deprecated 'comms' module from allowed_modules array
UPDATE allowed_emails
   SET allowed_modules = array_remove(allowed_modules, 'comms')
 WHERE 'comms' = ANY(allowed_modules);
