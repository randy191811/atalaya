-- Más detalle del objeto en la ficha: nivel de objeto y si está corrompido,
-- igual que lo muestra el juego al pasar el ratón por encima.
ALTER TABLE listings ADD COLUMN item_level INTEGER;
ALTER TABLE listings ADD COLUMN corrupted INTEGER NOT NULL DEFAULT 0;
