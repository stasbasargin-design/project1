-- =====================================================
-- Схема рабочей базы для проекта интеграции 1С → Bitrix24
-- База: account
-- =====================================================

-- Очередь событий от Экстрактора
CREATE TABLE IF NOT EXISTS sync_queue (
    id              BIGSERIAL PRIMARY KEY,
    object_guid     UUID NOT NULL,
    object_type     VARCHAR(50) NOT NULL,          -- call, work_order, appointment, commercial_offer, status_change
    object_number   VARCHAR(100),
    event_date      TIMESTAMP WITH TIME ZONE,
    payload         JSONB NOT NULL DEFAULT '{}',    -- полные данные объекта из 1С
    status          VARCHAR(30) NOT NULL DEFAULT 'new',  -- new, processing, done, error
    error_message   TEXT,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    processed_at    TIMESTAMP WITH TIME ZONE,
    retry_count     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);
CREATE INDEX IF NOT EXISTS idx_sync_queue_guid ON sync_queue(object_guid);
CREATE INDEX IF NOT EXISTS idx_sync_queue_created ON sync_queue(created_at);

-- Связь объекта 1С с карточкой Bitrix24
CREATE TABLE IF NOT EXISTS bitrix_links (
    object_guid     UUID PRIMARY KEY,
    bitrix_id       BIGINT,
    bitrix_entity   VARCHAR(50) DEFAULT 'deal',    -- deal или dynamic (smart-process)
    last_stage_id   VARCHAR(100),
    last_stage_name VARCHAR(200),
    responsible_id  BIGINT,
    last_update     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Лог обработки n8n
CREATE TABLE IF NOT EXISTS processing_log (
    id              BIGSERIAL PRIMARY KEY,
    object_guid     UUID,
    queue_id        BIGINT,
    workflow        VARCHAR(100),
    status          VARCHAR(30),                   -- success, error, skipped
    message         TEXT,
    details         JSONB,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_processing_log_guid ON processing_log(object_guid);
CREATE INDEX IF NOT EXISTS idx_processing_log_created ON processing_log(created_at);

-- Справочник направлений и причин (для удобства)
CREATE TABLE IF NOT EXISTS dict_directions (
    code            VARCHAR(50) PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,
    bitrix_stage_id VARCHAR(100),
    description     TEXT
);

CREATE TABLE IF NOT EXISTS dict_loss_reasons (
    code            VARCHAR(50) PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,
    default_deadline_hours INTEGER,
    responsible_role VARCHAR(50),                  -- curator, ko, manager_mp, service_head
    bitrix_stage_id VARCHAR(100)
);

-- Комментарий
COMMENT ON TABLE sync_queue IS 'Очередь событий, которые пишет Экстрактор 1С';
COMMENT ON TABLE bitrix_links IS 'Постоянная связь object_guid из 1С с ID карточки Bitrix24';
COMMENT ON TABLE processing_log IS 'История обработки событий n8n';
