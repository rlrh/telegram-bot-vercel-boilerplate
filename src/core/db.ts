import postgres from 'postgres';

const sql = postgres({
  host: process.env.DATABASE_HOST,
  database: process.env.DATABASE_NAME,
  username: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  ssl: 'require',
  transform: {
    undefined: null
  }
});

export const initDb = async () => {
  console.log("init db")
  await sql`
    CREATE TABLE IF NOT EXISTS site_files 
    (
      file_id VARCHAR PRIMARY KEY,
      file_url VARCHAR,
      file_type VARCHAR,
      media_group_id VARCHAR,
      message_id INTEGER,
      chat_id VARCHAR,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      UNIQUE (message_id, chat_id)
    )
  `;
};

export const isChatRegistered = async (chatId: number) => {
  const chats =
    await sql`SELECT EXISTS(SELECT 1 FROM site_chat_ids WHERE chat_id = ${String(chatId)})`;
  console.log(chats, chatId)
  if (!chats.length) return false;
  return chats[0].exists;
};

export const getExpiredFiles = async (expiryMinutes: number) => {
  return await sql`
    SELECT * 
    FROM site_files 
    WHERE updated_at < NOW() - ${expiryMinutes} * INTERVAL '1 minute'
  `;
};

export const upsertFile = async (
  fileId: string,
  fileUrl: string,
  fileType: string,
  chatId: number,
  messageId: number,
  mediaGroupId?: string,
) => {
  const files = await sql`
    INSERT INTO site_files (file_id, file_url, file_type, media_group_id, message_id, chat_id) 
    VALUES (${fileId}, ${fileUrl}, ${fileType}, ${mediaGroupId ?? null}, ${messageId}, ${String(chatId)})
    ON CONFLICT (message_id, chat_id) DO UPDATE SET
      file_id = EXCLUDED.file_id,
      file_url = EXCLUDED.file_url,
      file_type = EXCLUDED.file_type,
      updated_at = NOW()
    RETURNING *
  `;
  return files.length > 0;
};

export const updateFileUrl = async (fileId: string, fileUrl: string) => {
  const result = await sql`
    UPDATE site_files 
    SET 
      file_url = ${fileUrl},
      updated_at = NOW()
    WHERE file_id = ${fileId}
    RETURNING *
  `;
  return result.length > 0;
};

export default sql;
