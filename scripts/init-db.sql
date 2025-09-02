-- Create the main database (already created by POSTGRES_DB)
-- Create the test database
CREATE DATABASE cantolyr_test;

-- Grant permissions to the cantolyr user for both databases
GRANT ALL PRIVILEGES ON DATABASE cantolyr TO cantolyr;
GRANT ALL PRIVILEGES ON DATABASE cantolyr_test TO cantolyr;