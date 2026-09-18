-- New diff classification for import rows whose only change is the product's
-- MSRP reference data (see lib/catalog/import/diff.ts). MSRP never touches
-- price_epoch; it updates product.msrp_minor at publish.
ALTER TYPE "catalog_import_row_diff_type" ADD VALUE IF NOT EXISTS 'msrp_change';
