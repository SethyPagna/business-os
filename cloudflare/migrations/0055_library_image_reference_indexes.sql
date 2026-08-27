-- §15: the Library expands one physical image into one logical row per
-- referencing product. These joins are on the stored public path; without
-- indexes every page/search would scan both product tables and recreate the
-- D1 rows-read growth this work is intended to stop.
CREATE INDEX IF NOT EXISTS idx_products_image_path ON products(image_path);
CREATE INDEX IF NOT EXISTS idx_product_images_image_path ON product_images(image_path);
