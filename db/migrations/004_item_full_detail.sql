-- La ficha completa del objeto tal como la enseña el juego: propiedades (daño, crítico,
-- ataques por segundo…), requisitos, implícitos, afijos, descripción de uso y texto de sabor.
ALTER TABLE listings ADD COLUMN detail_json TEXT;
