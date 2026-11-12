-- Remove deprecated 'upload' module from allowed_modules array
UPDATE allowed_emails
   SET allowed_modules = array_remove(allowed_modules, 'upload')
 WHERE 'upload' = ANY(allowed_modules);
