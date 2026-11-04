// Migraciones en orden. Nunca editar una ya aplicada: agregar una nueva al final.
export const migrations: string[] = [
  /* 1: esquema inicial */ `
  CREATE TABLE users (
    id          INTEGER PRIMARY KEY,
    oid         TEXT UNIQUE,
    email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name        TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'usuario' CHECK (role IN ('admin','usuario','lectura')),
    phone       TEXT,
    last_login  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE sessions (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TEXT NOT NULL
  );

  CREATE TABLE locations (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    parent_id   INTEGER REFERENCES locations(id) ON DELETE RESTRICT,
    kind        TEXT NOT NULL DEFAULT 'otro'
                CHECK (kind IN ('deposito','armario','lab','rack','estante','otro')),
    notes       TEXT,
    sort        INTEGER NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX locations_name_parent ON locations(name COLLATE NOCASE, IFNULL(parent_id, 0));

  CREATE TABLE categories (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color       TEXT
  );

  CREATE TABLE items (
    id            INTEGER PRIMARY KEY,
    code          TEXT UNIQUE,
    category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    description   TEXT NOT NULL,
    brand         TEXT,
    part_number   TEXT,
    serial_number TEXT,
    location_id   INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    status        TEXT NOT NULL DEFAULT 'disponible'
                  CHECK (status IN ('disponible','prestado','reservado','en_uso','en_reparacion','roto','baja')),
    kind          TEXT NOT NULL DEFAULT 'unidad' CHECK (kind IN ('unidad','consumible')),
    quantity      REAL NOT NULL DEFAULT 1,
    unit          TEXT,
    min_stock     REAL,
    box_mismatch  INTEGER NOT NULL DEFAULT 0,
    notes         TEXT,
    source        TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    created_by    INTEGER REFERENCES users(id),
    updated_by    INTEGER REFERENCES users(id)
  );
  CREATE INDEX items_location ON items(location_id);
  CREATE INDEX items_category ON items(category_id);
  CREATE INDEX items_serial ON items(serial_number COLLATE NOCASE);

  CREATE TABLE contacts (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    company     TEXT,
    phone       TEXT,
    email       TEXT,
    notes       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE loans (
    id                  INTEGER PRIMARY KEY,
    item_id             INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    contact_id          INTEGER NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
    quantity            REAL NOT NULL DEFAULT 1,
    loaned_at           TEXT NOT NULL,
    due_date            TEXT,
    returned_at         TEXT,
    loaned_by           INTEGER REFERENCES users(id),
    returned_by         INTEGER REFERENCES users(id),
    notes               TEXT,
    reminder_every_days INTEGER,
    reminders_paused    INTEGER NOT NULL DEFAULT 0,
    last_reminder_at    TEXT,
    reminder_count      INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX loans_active ON loans(returned_at);
  CREATE INDEX loans_item ON loans(item_id);

  CREATE TABLE notifications (
    id          INTEGER PRIMARY KEY,
    kind        TEXT NOT NULL,
    loan_id     INTEGER REFERENCES loans(id) ON DELETE SET NULL,
    item_id     INTEGER REFERENCES items(id) ON DELETE SET NULL,
    recipient   TEXT NOT NULL,
    message     TEXT NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('enviado','error','omitido')),
    error       TEXT,
    sent_by     INTEGER REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE movements (
    id          INTEGER PRIMARY KEY,
    item_id     INTEGER REFERENCES items(id) ON DELETE CASCADE,
    user_id     INTEGER REFERENCES users(id),
    action      TEXT NOT NULL,
    detail      TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    reverted_at TEXT,
    reverted_by INTEGER REFERENCES users(id)
  );
  CREATE INDEX movements_item ON movements(item_id);
  CREATE INDEX movements_user ON movements(user_id);

  -- Stock mínimo por modelo (ej. "SFP-10G-SR-S: mínimo 10"): cuenta las unidades disponibles
  -- cuyo modelo o part number coincide.
  CREATE TABLE model_stock (
    id          INTEGER PRIMARY KEY,
    model       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    min_qty     REAL NOT NULL,
    notes       TEXT
  );

  CREATE TABLE settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL
  );

  INSERT INTO categories (name) VALUES
    ('Networking'), ('Embalaje / Varios'), ('Energía / Fuentes'), ('AV / Display'), ('AV / Video'),
    ('Iluminación'), ('Herramientas / Repuestos'), ('Seguridad / Acceso'), ('Cables / Patch'),
    ('Eléctrico'), ('SFP / Ópticos'), ('Otros');
  `,

  /* 2: los recordatorios van a un responsable de la empresa, no al que se llevó el equipo */ `
  ALTER TABLE loans ADD COLUMN responsible_id INTEGER REFERENCES users(id);
  UPDATE loans SET responsible_id = loaned_by WHERE responsible_id IS NULL;
  `,

  /* 3: "en uso" por alguien de Silk (se lo llevó a un trabajo, lo tiene en su oficina): no es un préstamo */ `
  ALTER TABLE items ADD COLUMN assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL;
  `,

  /* 4: empresas sin nombres repetidos. Une las que ya estén duplicadas (los préstamos pasan a la más vieja). */ `
  UPDATE loans SET contact_id = (
    SELECT MIN(c2.id) FROM contacts c2
     WHERE lower(trim(c2.name)) = (SELECT lower(trim(c.name)) FROM contacts c WHERE c.id = loans.contact_id)
  );
  DELETE FROM contacts WHERE id NOT IN (SELECT MIN(id) FROM contacts GROUP BY lower(trim(name)));
  CREATE UNIQUE INDEX contacts_name_unique ON contacts(lower(trim(name)));
  `,
];
