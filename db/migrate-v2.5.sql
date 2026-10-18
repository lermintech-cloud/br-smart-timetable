-- v2.5: รองรับครู 2 คนต่อคาบ
-- สำหรับฐานข้อมูลที่ติดตั้งไว้แล้ว: รัน "ครั้งเดียว" เท่านั้น (รันซ้ำจะ error duplicate column ซึ่งไม่เป็นอันตราย)
-- wrangler d1 execute br-timetable --remote --file=db/migrate-v2.5.sql
ALTER TABLE entries ADD COLUMN teacher2_id INTEGER;
ALTER TABLE assignments ADD COLUMN teacher2_id INTEGER;
