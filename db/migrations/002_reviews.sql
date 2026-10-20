-- Revisor de precios: cómo está cada anuncio frente a los anuncios parecidos del mercado.
CREATE TABLE listing_reviews (
  shop_id INTEGER NOT NULL,
  item_fp TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  comp_count INTEGER NOT NULL DEFAULT 0,
  comp_min_ex REAL,
  comp_median_ex REAL,
  own_ex REAL,
  verdict TEXT NOT NULL CHECK (verdict IN ('caro','en_precio','barato','sin_datos')),
  PRIMARY KEY (shop_id, item_fp)
);
