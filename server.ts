import express from "express";
import "dotenv/config";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import session from "express-session";
import SQLiteStoreFactory from "connect-sqlite3";
const SQLiteStore = SQLiteStoreFactory(session);

import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import { spawn, ChildProcess, exec } from "child_process";
import { promisify } from "util";
import os from "os";
import checkDiskSpace from "check-disk-space";
import { GoogleGenAI } from "@google/genai";
import axios from "axios";
import { File as MegaFile } from "megajs";
import Busboy from "busboy";
import cors from "cors";
import { Server as SocketServer } from "socket.io";
import http from "http";

const execAsync = promisify(exec);

declare module "express-session" {
  interface SessionData {
    user: { id: number; username: string; role: string };
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure directories exist
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
const THUMBNAILS_DIR = path.join(process.cwd(), "thumbnails");
const PROFILES_DIR = path.join(process.cwd(), "profiles");
const DATA_DIR = path.join(process.cwd(), "data");
const CHUNKS_DIR = path.join(process.cwd(), "chunks");

console.log(`Initializing directories in: ${process.cwd()}`);
[UPLOADS_DIR, THUMBNAILS_DIR, PROFILES_DIR, DATA_DIR, CHUNKS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
  // Ensure directory is writable
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch (e) {
    console.log(`Directory ${dir} is not writable, attempting to fix permissions...`);
    try {
      fs.chmodSync(dir, 0o777);
    } catch (chmodError) {
      console.error(`Failed to fix permissions for ${dir}:`, chmodError);
    }
  }
});

// Move existing DB files to data/ if they exist in root to avoid git update locks
const dbFiles = ["saungstream.db", "sessions.db", "saungstream.db-shm", "saungstream.db-wal"];
dbFiles.forEach(file => {
  const oldPath = path.join(process.cwd(), file);
  const newPath = path.join(DATA_DIR, file);
  if (fs.existsSync(oldPath)) {
    if (!fs.existsSync(newPath)) {
      try {
        fs.renameSync(oldPath, newPath);
        console.log(`Successfully moved ${file} to data/ folder`);
      } catch (e) {
        console.error(`Failed to move ${file} to data/ folder:`, e);
      }
    } else {
      // If both exist, delete the old one to avoid confusion
      try {
        fs.unlinkSync(oldPath);
      } catch (e) {}
    }
  }
  
  // Ensure database files are writable if they exist in data/
  if (fs.existsSync(newPath)) {
    try {
      fs.accessSync(newPath, fs.constants.W_OK);
    } catch (e) {
      console.log(`File ${newPath} is not writable, attempting to fix permissions...`);
      try {
        fs.chmodSync(newPath, 0o666);
      } catch (chmodError) {
        console.error(`Failed to fix permissions for ${newPath}:`, chmodError);
      }
    }
  }
});

// Database setup
const db = new Database(path.join(DATA_DIR, "saungstream.db"));
db.pragma("journal_mode = WAL");

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'member', -- admin, member
    status TEXT DEFAULT 'active', -- active, inactive
    storage_limit INTEGER DEFAULT 10, -- in GB
    profile_picture TEXT,
    login_attempts INTEGER DEFAULT 0,
    lockout_until DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    filename TEXT,
    filepath TEXT,
    duration INTEGER,
    thumbnail_path TEXT,
    size INTEGER DEFAULT 0,
    status TEXT DEFAULT 'ready', -- ready, processing, failed
    is_pre_encoded INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS youtube_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    channel_id TEXT UNIQUE,
    title TEXT,
    thumbnail TEXT,
    access_token TEXT,
    refresh_token TEXT,
    expiry_date INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT,
    loop INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS playlist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id INTEGER,
    media_id INTEGER,
    order_index INTEGER,
    FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
    FOREIGN KEY(media_id) REFERENCES media(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS streams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT,
    source_type TEXT DEFAULT 'playlist', -- playlist, video
    playlist_id INTEGER,
    video_id INTEGER,
    platform TEXT DEFAULT 'youtube', -- youtube, facebook, tiktok, shopee, twitch
    youtube_channel_id INTEGER,
    broadcast_id TEXT,
    youtube_stream_id TEXT,
    rtmp_url TEXT,
    stream_key TEXT,
    description TEXT,
    bitrate INTEGER DEFAULT 6000,
    resolution TEXT DEFAULT '1920x1080',
    status TEXT DEFAULT 'idle',
    last_triggered TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(playlist_id) REFERENCES playlists(id),
    FOREIGN KEY(video_id) REFERENCES media(id),
    FOREIGN KEY(youtube_channel_id) REFERENCES youtube_channels(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS stream_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    stream_id INTEGER,
    start_time TEXT,
    start_date TEXT,
    repeat_type TEXT, -- none, daily, weekly, monthly
    repeat_days TEXT, -- mon,tue,wed...
    repeat_date INTEGER,
    enabled INTEGER DEFAULT 1,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(stream_id) REFERENCES streams(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NULL,
    username TEXT,
    action TEXT,
    message TEXT,
    type TEXT DEFAULT 'info', -- info, error
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS metadata_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    day_of_week INTEGER, -- 0 (Sun) to 6 (Sat)
    slot_index INTEGER,  -- 0 to 9 (0-4 morning, 5-9 afternoon)
    title TEXT,
    description TEXT,
    thumbnail_url TEXT,
    topic TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// --- Migrations ---
const migrate = () => {
  const tables = ["users", "media", "playlists", "streams", "logs", "metadata_slots"];
  tables.forEach(table => {
    const tableInfo = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
    const columns = tableInfo.map(c => c.name);
    
    if (table !== "users" && !columns.includes("user_id")) {
      db.prepare(`ALTER TABLE ${table} ADD COLUMN user_id INTEGER`).run();
    }
    
    if (table === "users") {
      if (!columns.includes("role")) db.prepare("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'member'").run();
      if (!columns.includes("status")) db.prepare("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'").run();
      if (!columns.includes("storage_limit")) db.prepare("ALTER TABLE users ADD COLUMN storage_limit INTEGER DEFAULT 10").run();
      if (!columns.includes("profile_picture")) db.prepare("ALTER TABLE users ADD COLUMN profile_picture TEXT").run();
      if (!columns.includes("login_attempts")) db.prepare("ALTER TABLE users ADD COLUMN login_attempts INTEGER DEFAULT 0").run();
      if (!columns.includes("lockout_until")) db.prepare("ALTER TABLE users ADD COLUMN lockout_until DATETIME").run();
      if (!columns.includes("expires_at")) db.prepare("ALTER TABLE users ADD COLUMN expires_at DATETIME").run();
    }
    
    if (table === "media") {
      if (!columns.includes("status")) db.prepare("ALTER TABLE media ADD COLUMN status TEXT DEFAULT 'ready'").run();
      if (!columns.includes("is_pre_encoded")) db.prepare("ALTER TABLE media ADD COLUMN is_pre_encoded INTEGER DEFAULT 0").run();
      if (!columns.includes("size")) db.prepare("ALTER TABLE media ADD COLUMN size INTEGER DEFAULT 0").run();
    }
    
    if (table === "streams") {
      if (!columns.includes("source_type")) db.prepare("ALTER TABLE streams ADD COLUMN source_type TEXT DEFAULT 'playlist'").run();
      if (!columns.includes("video_id")) db.prepare("ALTER TABLE streams ADD COLUMN video_id INTEGER").run();
      if (!columns.includes("platform")) db.prepare("ALTER TABLE streams ADD COLUMN platform TEXT DEFAULT 'youtube'").run();
      if (!columns.includes("youtube_channel_id")) db.prepare("ALTER TABLE streams ADD COLUMN youtube_channel_id INTEGER").run();
      if (!columns.includes("broadcast_id")) db.prepare("ALTER TABLE streams ADD COLUMN broadcast_id TEXT").run();
      if (!columns.includes("youtube_stream_id")) db.prepare("ALTER TABLE streams ADD COLUMN youtube_stream_id TEXT").run();
      if (!columns.includes("description")) db.prepare("ALTER TABLE streams ADD COLUMN description TEXT").run();
      if (!columns.includes("loop")) db.prepare("ALTER TABLE streams ADD COLUMN loop INTEGER DEFAULT 1").run();
      if (!columns.includes("duration")) db.prepare("ALTER TABLE streams ADD COLUMN duration REAL DEFAULT -1").run();
      if (!columns.includes("started_at")) db.prepare("ALTER TABLE streams ADD COLUMN started_at DATETIME").run();
      if (!columns.includes("start_time")) db.prepare("ALTER TABLE streams ADD COLUMN start_time TEXT").run();
      if (!columns.includes("start_date")) db.prepare("ALTER TABLE streams ADD COLUMN start_date TEXT").run();
      if (!columns.includes("repeat_type")) db.prepare("ALTER TABLE streams ADD COLUMN repeat_type TEXT DEFAULT 'none'").run();
      if (!columns.includes("repeat_days")) db.prepare("ALTER TABLE streams ADD COLUMN repeat_days TEXT").run();
      if (!columns.includes("repeat_date")) db.prepare("ALTER TABLE streams ADD COLUMN repeat_date INTEGER").run();
      if (!columns.includes("schedule_enabled")) db.prepare("ALTER TABLE streams ADD COLUMN schedule_enabled INTEGER DEFAULT 0").run();
      if (!columns.includes("last_triggered")) db.prepare("ALTER TABLE streams ADD COLUMN last_triggered TEXT").run();
      if (!columns.includes("network_optimization")) db.prepare("ALTER TABLE streams ADD COLUMN network_optimization INTEGER DEFAULT 1").run();
      if (!columns.includes("use_ai_metadata")) db.prepare("ALTER TABLE streams ADD COLUMN use_ai_metadata INTEGER DEFAULT 1").run();
      
      // New YouTube Metadata columns
      if (!columns.includes("youtube_playlists")) db.prepare("ALTER TABLE streams ADD COLUMN youtube_playlists TEXT").run();
      if (!columns.includes("youtube_made_for_kids")) db.prepare("ALTER TABLE streams ADD COLUMN youtube_made_for_kids INTEGER DEFAULT 0").run();
      if (!columns.includes("youtube_age_restriction")) db.prepare("ALTER TABLE streams ADD COLUMN youtube_age_restriction INTEGER DEFAULT 0").run();
      if (!columns.includes("youtube_paid_promotion")) db.prepare("ALTER TABLE streams ADD COLUMN youtube_paid_promotion INTEGER DEFAULT 0").run();
      if (!columns.includes("youtube_altered_content")) db.prepare("ALTER TABLE streams ADD COLUMN youtube_altered_content INTEGER DEFAULT 0").run();
      if (!columns.includes("youtube_automatic_chapters")) db.prepare("ALTER TABLE streams ADD COLUMN youtube_automatic_chapters INTEGER DEFAULT 1").run();
      if (!columns.includes("youtube_featured_places")) db.prepare("ALTER TABLE streams ADD COLUMN youtube_featured_places INTEGER DEFAULT 1").run();
      if (!columns.includes("youtube_automatic_concepts")) db.prepare("ALTER TABLE streams ADD COLUMN youtube_automatic_concepts INTEGER DEFAULT 1").run();
      if (!columns.includes("youtube_tags")) db.prepare("ALTER TABLE streams ADD COLUMN youtube_tags TEXT").run();
      if (!columns.includes("youtube_language")) db.prepare("ALTER TABLE streams ADD COLUMN youtube_language TEXT DEFAULT 'id'").run();
      if (!columns.includes("youtube_caption_certification")) db.prepare("ALTER TABLE streams ADD COLUMN youtube_caption_certification TEXT").run();
      if (!columns.includes("youtube_title_description_language")) db.prepare("ALTER TABLE streams ADD COLUMN youtube_title_description_language TEXT DEFAULT 'id'").run();
      if (!columns.includes("youtube_recording_date")) db.prepare("ALTER TABLE streams ADD COLUMN youtube_recording_date TEXT").run();
      if (!columns.includes("youtube_recording_location")) db.prepare("ALTER TABLE streams ADD COLUMN youtube_recording_location TEXT").run();
      if (!columns.includes("youtube_license")) db.prepare("ALTER TABLE streams ADD COLUMN youtube_license TEXT DEFAULT 'youtube'").run();
      if (!columns.includes("youtube_allow_embedding")) db.prepare("ALTER TABLE streams ADD COLUMN youtube_allow_embedding INTEGER DEFAULT 0").run();
      if (!columns.includes("youtube_publish_to_subscriptions")) db.prepare("ALTER TABLE streams ADD COLUMN youtube_publish_to_subscriptions INTEGER DEFAULT 1").run();
      if (!columns.includes("youtube_shorts_remixing")) db.prepare("ALTER TABLE streams ADD COLUMN youtube_shorts_remixing TEXT DEFAULT 'allow_video_audio'").run();
      if (!columns.includes("youtube_category")) db.prepare("ALTER TABLE streams ADD COLUMN youtube_category TEXT DEFAULT '10'").run(); // 10 is Music
      if (!columns.includes("thumbnail_path")) db.prepare("ALTER TABLE streams ADD COLUMN thumbnail_path TEXT").run();
      if (!columns.includes("youtube_comments_mode")) db.prepare("ALTER TABLE streams ADD COLUMN youtube_comments_mode TEXT DEFAULT 'on'").run();
      if (!columns.includes("youtube_who_can_comment")) db.prepare("ALTER TABLE streams ADD COLUMN youtube_who_can_comment TEXT DEFAULT 'anyone'").run();
      if (!columns.includes("youtube_sort_by")) db.prepare("ALTER TABLE streams ADD COLUMN youtube_sort_by TEXT DEFAULT 'top'").run();
      if (!columns.includes("force_encoding")) db.prepare("ALTER TABLE streams ADD COLUMN force_encoding INTEGER DEFAULT 0").run();
    }

    if (table === "metadata_slots") {
      if (!columns.includes("is_used")) db.prepare("ALTER TABLE metadata_slots ADD COLUMN is_used INTEGER DEFAULT 0").run();
      if (!columns.includes("last_used_at")) db.prepare("ALTER TABLE metadata_slots ADD COLUMN last_used_at DATETIME").run();
      if (!columns.includes("last_number")) db.prepare("ALTER TABLE metadata_slots ADD COLUMN last_number INTEGER DEFAULT 0").run();
      if (!columns.includes("sub_index")) db.prepare("ALTER TABLE metadata_slots ADD COLUMN sub_index INTEGER DEFAULT 0").run();
      if (!columns.includes("tags")) db.prepare("ALTER TABLE metadata_slots ADD COLUMN tags TEXT").run();
    }

    if (table === "logs") {
      if (!columns.includes("username")) db.prepare("ALTER TABLE logs ADD COLUMN username TEXT").run();
      if (!columns.includes("action")) db.prepare("ALTER TABLE logs ADD COLUMN action TEXT").run();
      if (!columns.includes("message")) {
        if (columns.includes("details")) {
          db.prepare("ALTER TABLE logs RENAME COLUMN details TO message").run();
        } else {
          db.prepare("ALTER TABLE logs ADD COLUMN message TEXT").run();
        }
      }
      if (!columns.includes("timestamp")) db.prepare("ALTER TABLE logs ADD COLUMN timestamp DATETIME DEFAULT CURRENT_TIMESTAMP").run();
    }
  });
};
migrate();

// Check for successful update after restart
const checkUpdateStatus = async () => {
  try {
    const pendingHash = db.prepare("SELECT value FROM settings WHERE key = 'pending_update_hash'").get() as any;
    if (pendingHash) {
      const { stdout } = await execAsync("git rev-parse --short HEAD");
      const currentHash = stdout.trim();
      
      if (currentHash === pendingHash.value) {
        const pendingUser = db.prepare("SELECT value FROM settings WHERE key = 'pending_update_user'").get() as any;
        const username = pendingUser ? pendingUser.value : "System";
        
        // Get the commit message
        const { stdout: commitMsg } = await execAsync("git log -1 --pretty=%B");
        const message = commitMsg.trim();
        
        logAction(null as any, username, "System Update Success", `Update to version ${currentHash} was successful. Latest commit: ${message}`);
        
        // Set a flag for the frontend to show an announcement
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_update_success', ?)").run(JSON.stringify({
          hash: currentHash,
          message: message,
          timestamp: new Date().toISOString()
        }));
        
        console.log(`Update verified: ${currentHash}`);
      } else {
        console.log(`Update mismatch: expected ${pendingHash.value}, got ${currentHash}`);
      }
      
      // Clear pending update info
      db.prepare("DELETE FROM settings WHERE key = 'pending_update_hash'").run();
      db.prepare("DELETE FROM settings WHERE key = 'pending_update_user'").run();
    }
  } catch (e) {
    console.error("Failed to verify update status:", e);
  }
};
checkUpdateStatus();

// Ensure admin user exists with 'admin' as password and admin role
const adminUser = db.prepare("SELECT * FROM users WHERE username = 'admin'").get() as any;
const defaultHashedPassword = bcrypt.hashSync("admin", 10);
if (!adminUser) {
  db.prepare("INSERT INTO users (username, password, role, status, storage_limit) VALUES (?, ?, ?, ?, ?)")
    .run("admin", defaultHashedPassword, "admin", "active", 100);
} else {
  // Reset admin password to 'admin' and ensure role/status
  db.prepare("UPDATE users SET password = ?, role = 'admin', status = 'active', storage_limit = 100 WHERE username = 'admin'").run(defaultHashedPassword);
}

const app = express();
app.set('trust proxy', 1);
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    const allowedPatterns = [
      /saungstream\.my\.id$/,
      /localhost/,
      /127\.0\.0\.1/,
      /\.run\.app$/ // Allow AI Studio preview
    ];

    const isAllowed = allowedPatterns.some(pattern => pattern.test(origin));

    if (isAllowed) {
      callback(null, true);
    } else {
      console.log('CORS Blocked Origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json({ limit: '10gb' }));
app.use(express.urlencoded({ extended: true, limit: '10gb' }));
app.use(session({
  secret: "saungstream-secret",
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore({ db: "sessions.db", dir: DATA_DIR }),
  cookie: { 
    secure: false, // Set to true if using https
    maxAge: 24 * 60 * 60 * 1000 
  }
}));

// Auth Middleware
const requireAuth = (req: any, res: any, next: any) => {
  if (req.session.user) {
    const user = db.prepare("SELECT status FROM users WHERE id = ?").get(req.session.user.id) as any;
    if (user && user.status === 'active') {
      next();
    } else {
      req.session.destroy(() => {
        res.status(401).json({ error: "Account is inactive or not found" });
      });
    }
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
};

const requireAdmin = (req: any, res: any, next: any) => {
  if (req.session.user && req.session.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: "Forbidden: Admin access required" });
  }
};

// --- Automation Helpers ---
const getISOWithOffset = (dateStr: string, timeStr: string, tz: string) => {
  try {
    const date = new Date(`${dateStr}T${timeStr}:00`);
    // Get the offset in minutes for the given timezone at the given date
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'longOffset'
    }).formatToParts(date);
    
    const offsetPart = parts.find(p => p.type === 'timeZoneName')?.value || "";
    // offsetPart is like "GMT+07:00" or "GMT-05:00" or "GMT"
    let offset = "+00:00";
    if (offsetPart.includes("+")) offset = offsetPart.split("+")[1];
    else if (offsetPart.includes("-")) offset = "-" + offsetPart.split("-")[1];
    
    if (offset === "GMT") offset = "+00:00";
    if (offset.length === 5 && !offset.includes(":")) offset = offset.slice(0, 3) + ":" + offset.slice(3);
    if (!offset.includes(":")) offset += ":00";
    if (!offset.startsWith("+") && !offset.startsWith("-")) offset = "+" + offset;

    return `${dateStr}T${timeStr}:00${offset}`;
  } catch (e) {
    return new Date(`${dateStr}T${timeStr}:00Z`).toISOString();
  }
};

const getMetadataForTime = (userId: number, date: Date, timezone: string, markAsUsed: boolean = false) => {
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour12: false,
      hour: '2-digit',
      weekday: 'short'
    });
    const parts = formatter.formatToParts(date);
    const dateParts: any = {};
    parts.forEach(p => dateParts[p.type] = p.value);
    
    const dayMap: any = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
    const dayOfWeek = dayMap[dateParts.weekday] ?? date.getDay();
    const hour = parseInt(dateParts.hour);
    
    // Map 24 hours to 10 slots (2.4 hours per slot)
    const slotIndex = Math.min(9, Math.floor(hour / 2.4));
    
    // Find an unused slot for this time, or fallback to any slot if all are used
    let slot = db.prepare(`
      SELECT * FROM metadata_slots 
      WHERE user_id = ? AND day_of_week = ? AND slot_index = ? AND is_used = 0
      ORDER BY id ASC LIMIT 1
    `).get(userId, dayOfWeek, slotIndex) as any;

    if (!slot) {
      // If all used, pick the oldest used one to rotate
      slot = db.prepare(`
        SELECT * FROM metadata_slots 
        WHERE user_id = ? AND day_of_week = ? AND slot_index = ?
        ORDER BY last_used_at ASC LIMIT 1
      `).get(userId, dayOfWeek, slotIndex) as any;
    }
      
    if (slot && markAsUsed) {
      const nextNumber = (slot.last_number || 0) + 1;
      const newTitle = slot.title.includes('#') 
        ? slot.title.replace(/#\d+$/, `#${nextNumber}`) 
        : `${slot.title} #${nextNumber}`;
        
      db.prepare("UPDATE metadata_slots SET is_used = 1, last_used_at = CURRENT_TIMESTAMP, last_number = ? WHERE id = ?")
        .run(nextNumber, slot.id);
      
      return { ...slot, title: newTitle };
    }

    return slot || null;
  } catch (e) {
    console.error("Error fetching metadata slot:", e);
    return null;
  }
};

const calculateNextRun = (stream: any, tz: string) => {
  const now = new Date();
  let nextRun = new Date();
  
  // Parse current scheduled time
  const [h, m] = (stream.start_time || "00:00").split(":").map(Number);
  const [year, month, day] = (stream.start_date || new Date().toISOString().slice(0, 10)).split("-").map(Number);
  
  // Create a date object for the current scheduled run in the target timezone
  // This is tricky because JS Date is UTC-based. We use a helper to get the "local" time components.
  const getLocalTime = (date: Date, timeZone: string) => {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false
    });
    const parts = fmt.formatToParts(date);
    const p: any = {};
    parts.forEach(part => p[part.type] = part.value);
    return new Date(`${p.year}-${p.month.padStart(2, '0')}-${p.day.padStart(2, '0')}T${p.hour.padStart(2, '0')}:${p.minute.padStart(2, '0')}:${p.second.padStart(2, '0')}`);
  };

  // For simplicity, we'll work with the current scheduled date/time and add intervals
  let baseDate = new Date(`${stream.start_date}T${stream.start_time}:00`);
  
  const intervalMap: any = { 
    "10min": 10, "30min": 30, "1hour": 60, "6hours": 360, "12hours": 720,
    "daily": 1440
  };

  if (intervalMap[stream.repeat_type]) {
    const minutes = intervalMap[stream.repeat_type];
    baseDate.setMinutes(baseDate.getMinutes() + minutes);
    // Ensure it's in the future
    while (baseDate <= now) {
      baseDate.setMinutes(baseDate.getMinutes() + minutes);
    }
  } else if (stream.repeat_type === "weekly") {
    const allowedDays = (stream.repeat_days || "").split(",").map(d => d.toLowerCase());
    const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    
    baseDate.setDate(baseDate.getDate() + 1); // Start checking from tomorrow
    while (baseDate <= now || !allowedDays.includes(dayNames[baseDate.getDay()])) {
      baseDate.setDate(baseDate.getDate() + 1);
    }
  } else if (stream.repeat_type === "monthly") {
    baseDate.setMonth(baseDate.getMonth() + 1);
    baseDate.setDate(stream.repeat_date || 1);
    while (baseDate <= now) {
      baseDate.setMonth(baseDate.getMonth() + 1);
    }
  } else {
    return null; // No next run
  }

  return {
    date: baseDate.toISOString().slice(0, 10),
    time: baseDate.toTimeString().slice(0, 5),
    fullDate: baseDate
  };
};

// --- FFmpeg Stream Manager ---
// --- Logging Helper ---
const logAction = (userId: number, username: string, action: string, message: string, type: string = 'info') => {
  db.prepare("INSERT INTO logs (user_id, username, action, message, type) VALUES (?, ?, ?, ?, ?)")
    .run(userId, username, action, message, type);
};

class StreamManager {
  private activeStreams: Map<number, ChildProcess> = new Map();

  async startStream(streamId: number) {
    if (this.activeStreams.has(streamId)) return { success: false, error: "Stream already active" };

    const stream = db.prepare(`
      SELECT s.*, p.loop as playlist_loop 
      FROM streams s 
      LEFT JOIN playlists p ON s.playlist_id = p.id 
      WHERE s.id = ?
    `).get(streamId) as any;
    if (!stream) return { success: false, error: "Stream not found" };

    // Automate YouTube if channel is selected
    if (stream.platform === 'youtube' && stream.youtube_channel_id && !stream.rtmp_url) {
      try {
        console.log(`Automating YouTube for stream: ${stream.name}`);
        await createYouTubeBroadcast(streamId);
        // Refresh stream data
        const updatedStream = db.prepare("SELECT * FROM streams WHERE id = ?").get(streamId) as any;
        Object.assign(stream, updatedStream);
        
        // Give YouTube a moment to prepare the ingestion server
        console.log("Waiting 7 seconds for YouTube ingestion server to be ready...");
        await new Promise(resolve => setTimeout(resolve, 7000));
      } catch (err: any) {
        const errMsg = err.response?.data?.error?.message || err.message || String(err);
        this.log(stream.user_id, "error", `Failed to automate YouTube for ${stream.name}: ${errMsg}`);
        return { success: false, error: `YouTube Error: ${errMsg}` };
      }
    }

    if (!stream.rtmp_url || !stream.stream_key) {
      this.log(stream.user_id, "error", `Stream ${stream.name} is missing RTMP URL or Stream Key.`);
      return { success: false, error: "Missing RTMP URL or Stream Key" };
    }

    let inputArgs: string[] = [];
    let loopFlag: string[] = [];
    let codecArgs: string[] = [];

    if (stream.source_type === 'video') {
      const video = db.prepare("SELECT * FROM media WHERE id = ?").get(stream.video_id) as any;
      if (!video) {
        this.log(stream.user_id, "error", `Stream ${stream.name} video source not found.`);
        return;
      }
      if (stream.loop) loopFlag = ["-stream_loop", "-1"];
      inputArgs = ["-i", video.filepath];

      if (video.is_pre_encoded && !stream.force_encoding) {
        this.log(stream.user_id, "info", `Using Direct Stream (No Encoding) for ${video.filename}`);
        codecArgs = ["-c", "copy"];
      } else {
        this.log(stream.user_id, "info", `Transcoding ${video.filename} (Force Encoding: ${!!stream.force_encoding})`);
        const [width, height] = (stream.resolution || "1280x720").split("x");
        const useOptimization = stream.network_optimization !== 0;
        codecArgs = [
          "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
          "-c:v", "libx264",
          "-preset", useOptimization ? "ultrafast" : "veryfast",
          "-tune", useOptimization ? "zerolatency" : "main",
          "-b:v", `${stream.bitrate}k`,
          "-maxrate", `${stream.bitrate}k`,
          "-minrate", `${stream.bitrate}k`,
          "-bufsize", `${stream.bitrate * 2}k`,
          "-pix_fmt", "yuv420p",
          "-g", "60",
          "-keyint_min", "60",
          "-sc_threshold", "0",
          "-r", "30",
          "-c:a", "aac",
          "-b:a", "128k",
          "-ar", "44100"
        ];
      }
    } else {
      const playlistItems = db.prepare(`
        SELECT m.* 
        FROM playlist_items pi 
        JOIN media m ON pi.media_id = m.id 
        WHERE pi.playlist_id = ? 
        ORDER BY pi.order_index ASC
      `).all(stream.playlist_id) as any[];

      if (playlistItems.length === 0) {
        this.log(stream.user_id, "error", `Stream ${stream.name} has no items in playlist.`);
        return { success: false, error: "Playlist is empty" };
      }

      const playlistFile = path.join(__dirname, `playlist_${streamId}.txt`);
      const content = playlistItems.map(item => `file '${item.filepath}'`).join("\n");
      fs.writeFileSync(playlistFile, content);
      
      if (stream.playlist_loop || stream.loop) loopFlag = ["-stream_loop", "-1"];
      inputArgs = ["-f", "concat", "-safe", "0", "-i", playlistFile];

      // For playlists, we usually re-encode to ensure transitions are smooth unless all items are identical in format
      const allPreEncoded = playlistItems.every(item => item.is_pre_encoded);
      if (allPreEncoded && !stream.force_encoding) {
        this.log(stream.user_id, "info", `Using Direct Stream (No Encoding) for playlist: ${stream.name}`);
        codecArgs = ["-c", "copy"];
      } else {
        this.log(stream.user_id, "info", `Transcoding playlist: ${stream.name} (Force Encoding: ${!!stream.force_encoding}, All Pre-encoded: ${allPreEncoded})`);
        const [width, height] = (stream.resolution || "1280x720").split("x");
        const useOptimization = stream.network_optimization !== 0;
        codecArgs = [
          "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
          "-c:v", "libx264",
          "-preset", useOptimization ? "ultrafast" : "veryfast",
          "-tune", useOptimization ? "zerolatency" : "main",
          "-b:v", `${stream.bitrate}k`,
          "-maxrate", `${stream.bitrate}k`,
          "-minrate", `${stream.bitrate}k`,
          "-bufsize", `${stream.bitrate * 2}k`,
          "-pix_fmt", "yuv420p",
          "-g", "60",
          "-keyint_min", "60",
          "-sc_threshold", "0",
          "-r", "30",
          "-c:a", "aac",
          "-b:a", "128k",
          "-ar", "44100"
        ];
      }
    }

    const rtmpBase = stream.rtmp_url.endsWith('/') ? stream.rtmp_url.slice(0, -1) : stream.rtmp_url;
    const rtmpDestination = `${rtmpBase}/${stream.stream_key}`;
    
    const maskedKey = stream.stream_key.length > 8 ? stream.stream_key.substring(0, 4) + '...' + stream.stream_key.substring(stream.stream_key.length - 4) : '***';
    console.log(`Streaming to: ${rtmpBase}/${maskedKey}`);

    const args = [
      "-re",
      ...loopFlag,
      ...inputArgs,
      ...codecArgs,
      "-f", "flv",
      rtmpDestination
    ];

    const maskedArgs = args.map(arg => arg === rtmpDestination ? `${rtmpBase}/${maskedKey}` : arg);
    this.log(stream.user_id, "info", `Starting FFmpeg for ${stream.name} with command: ffmpeg ${maskedArgs.join(' ')}`);

    const ffmpegProcess = spawn("ffmpeg", args);
    this.activeStreams.set(streamId, ffmpegProcess);
    
    // Handle stderr to prevent buffer overflow and for logging
    let errorOutput = "";
    ffmpegProcess.stderr.on("data", (data) => {
      const msg = data.toString();
      errorOutput += msg;
      if (errorOutput.length > 1000) errorOutput = errorOutput.slice(-1000);
      // Optional: log specific errors if needed
    });

    ffmpegProcess.stdout.on("data", (data) => {
      // Just drain it
    });

    db.prepare("UPDATE streams SET status = 'live', started_at = COALESCE(started_at, CURRENT_TIMESTAMP) WHERE id = ?").run(streamId);
    this.log(stream.user_id, "info", `Stream ${stream.name} started.`);

    ffmpegProcess.on("error", (err) => {
      this.log(stream.user_id, "error", `Stream ${stream.name} spawn error: ${err.message}`);
    });

    ffmpegProcess.on("close", (code) => {
      this.activeStreams.delete(streamId);
      const currentStream = db.prepare("SELECT * FROM streams WHERE id = ?").get(streamId) as any;
      
      if (currentStream && currentStream.status === 'live') {
        const lastError = errorOutput.split("\n")
          .filter(l => l.toLowerCase().includes("error") || l.toLowerCase().includes("failed") || l.toLowerCase().includes("fatal"))
          .slice(-5)
          .join(" | ");
        
        const restartMsg = `Stream ${stream.name} stopped unexpectedly (code ${code}). ${lastError ? 'Reason: ' + lastError : 'No specific error captured.'} Restarting in 10s...`;
        this.log(stream.user_id, "error", restartMsg);
        console.error(restartMsg);
        
        setTimeout(() => this.startStream(streamId), 10000);
      } else {
        db.prepare("UPDATE streams SET status = 'idle', started_at = NULL WHERE id = ?").run(streamId);
        this.log(stream.user_id, "info", `Stream ${stream.name} stopped.`);
        
        // Handle Repetition via Duplication
        if (currentStream && currentStream.repeat_type !== 'none' && currentStream.schedule_enabled === 1) {
          this.handleRepetition(currentStream);
        }
      }
      
      const playlistFile = path.join(__dirname, `playlist_${streamId}.txt`);
      if (fs.existsSync(playlistFile)) {
        try {
          fs.unlinkSync(playlistFile);
        } catch (e) {
          console.error(`Failed to delete playlist file: ${playlistFile}`, e);
        }
      }
    });

    return { success: true };
  }

  stopStream(streamId: number) {
    const currentStream = db.prepare("SELECT * FROM streams WHERE id = ?").get(streamId) as any;
    db.prepare("UPDATE streams SET status = 'idle', started_at = NULL WHERE id = ?").run(streamId);
    
    const process = this.activeStreams.get(streamId);
    if (process) {
      try {
        // Use SIGINT for cleaner shutdown, allowing FFmpeg to send trailer/end of stream
        process.kill("SIGINT");
        
        // If it doesn't stop in 5 seconds, force kill
        setTimeout(() => {
          if (this.activeStreams.has(streamId)) {
            try {
              process.kill("SIGKILL");
            } catch (e) {}
          }
        }, 5000);
      } catch (e) {
        console.error(`Failed to stop stream ${streamId}`, e);
      }
      this.activeStreams.delete(streamId);
    }
  }

  private async handleRepetition(stream: any) {
    try {
      const timezone = db.prepare("SELECT value FROM settings WHERE key = 'timezone'").get() as any;
      const tz = timezone ? timezone.value : "Asia/Jakarta";
      
      const nextRun = calculateNextRun(stream, tz);
      if (!nextRun) {
        // If no next run (e.g. repeat_type 'none'), just disable scheduling
        db.prepare("UPDATE streams SET schedule_enabled = 0 WHERE id = ?").run(stream.id);
        return;
      }

      // Pick metadata for the next run
      let newName = stream.name;
      let newDescription = stream.description;

      if (stream.use_ai_metadata === 1) {
        const metadata = getMetadataForTime(stream.user_id, nextRun.fullDate, tz, true);
        if (metadata) {
          newName = metadata.title || stream.name;
          newDescription = metadata.description || stream.description;
        }
      }
      
      // OVERWRITE the existing ticket with the next schedule
      db.prepare(`
        UPDATE streams 
        SET 
          name = ?, 
          description = ?, 
          start_time = ?, 
          start_date = ?, 
          status = 'idle', 
          started_at = NULL, 
          last_triggered = NULL,
          broadcast_id = NULL,
          youtube_stream_id = NULL
        WHERE id = ?
      `).run(
        newName, 
        newDescription,
        nextRun.time, 
        nextRun.date, 
        stream.id
      );

      this.log(stream.user_id, "info", `Stream "${stream.name}" rescheduled to ${nextRun.date} ${nextRun.time} (Overwrite Mode)`);
      
      // Auto-schedule on YouTube if applicable for the NEW time
      if (stream.platform === 'youtube' && stream.youtube_channel_id) {
        try {
          // Small delay to ensure DB is committed
          setTimeout(async () => {
            await createYouTubeBroadcast(stream.id);
            this.log(stream.user_id, "info", `Automatically scheduled next YouTube broadcast: ${newName}`);
          }, 2000);
        } catch (err) {
          this.log(stream.user_id, "error", `Failed to auto-schedule next YouTube broadcast: ${err}`);
        }
      }
    } catch (err) {
      console.error("Error handling stream repetition:", err);
      this.log(stream.user_id, "error", `Failed to create duplicate stream ticket: ${err}`);
    }
  }

  stopAll() {
    for (const [id, process] of this.activeStreams.entries()) {
      try {
        process.kill("SIGKILL");
      } catch (e) {}
    }
    this.activeStreams.clear();
  }

  private log(userId: number | null, type: string, message: string) {
    try {
      db.prepare("INSERT INTO logs (user_id, action, message, type) VALUES (?, ?, ?, ?)")
        .run(userId, "System", message, type);
    } catch (e) {
      console.error("Failed to write to logs table:", e);
    }
  }

  isLive(streamId: number) {
    return this.activeStreams.has(streamId);
  }

  async resumeLiveStreams() {
    try {
      const liveStreams = db.prepare("SELECT id, name FROM streams WHERE status = 'live'").all() as any[];
      if (liveStreams.length > 0) {
        console.log(`[Auto-Resume] Found ${liveStreams.length} streams to resume...`);
        for (const s of liveStreams) {
          console.log(`[Auto-Resume] Resuming stream: ${s.name} (ID: ${s.id})`);
          // Small delay between starts to avoid CPU spike and allow system to stabilize
          await new Promise(resolve => setTimeout(resolve, 3000));
          this.startStream(s.id);
        }
      }
    } catch (err) {
      console.error("[Auto-Resume] Error during resume:", err);
    }
  }
}

const streamManager = new StreamManager();

// --- Error Logging to File ---
const ERROR_LOG_DIR = path.join(__dirname, "logs");
if (!fs.existsSync(ERROR_LOG_DIR)) fs.mkdirSync(ERROR_LOG_DIR);

const writeToErrorLog = (error: any) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${error.stack || error}\n`;
  fs.appendFileSync(path.join(ERROR_LOG_DIR, "error.log"), logMessage);
};

process.on("uncaughtException", (err) => {
  writeToErrorLog(err);
  console.error("Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  writeToErrorLog(reason);
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

import { google } from "googleapis";

const getOAuth2Client = (req: any) => {
  // Detect protocol and host dynamically to support custom domains like app.saungstream.my.id
  let protocol = req.get('x-forwarded-proto') || req.protocol || 'http';
  let host = req.get('x-forwarded-host') || req.get('host');
  
  // Handle x-forwarded-host if it's a comma-separated list
  if (host && typeof host === 'string' && host.includes(',')) {
    host = host.split(',')[0].trim();
  }

  // Force https for non-localhost environments (Cloud Run/Production)
  if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
    protocol = 'https';
  }
  
  // Strip default ports (80, 443) as Google is strict about exact matches
  if (host && (host.endsWith(':80') || host.endsWith(':443'))) {
    host = host.split(':')[0];
  }

  const redirectUri = `${protocol}://${host}/api/auth/youtube/callback`;
  
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  console.log(`[YouTube OAuth Debug] Protocol: ${protocol}, Host: ${host}`);
  console.log(`[YouTube OAuth Debug] Redirect URI: ${redirectUri}`);
  console.log(`[YouTube OAuth Debug] Client ID starts with: ${clientId?.substring(0, 10)}...`);
  
  if (!clientId || !clientSecret) {
    console.error("[YouTube OAuth Error] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing in environment variables!");
  }

  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );
};

const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/userinfo.profile"
];

// --- YouTube OAuth Routes ---
app.get("/api/auth/youtube", requireAuth, (req, res) => {
  const client = getOAuth2Client(req);
  const url = client.generateAuthUrl({
    access_type: "offline",
    scope: YOUTUBE_SCOPES,
    prompt: "consent",
    state: req.session.user.id.toString()
  });
  res.json({ url });
});

app.get("/api/auth/youtube/callback", async (req, res) => {
  const { code, state } = req.query;
  const userId = parseInt(state as string);
  const client = getOAuth2Client(req);

  try {
    const { tokens } = await client.getToken(code as string);
    client.setCredentials(tokens);

    const youtube = google.youtube({ version: "v3", auth: client });
    const channelRes = await youtube.channels.list({
      part: ["snippet", "contentDetails"],
      mine: true
    });

    const channel = channelRes.data.items?.[0];
    if (!channel) throw new Error("No YouTube channel found");

    db.prepare(`
      INSERT OR REPLACE INTO youtube_channels 
      (user_id, channel_id, title, thumbnail, access_token, refresh_token, expiry_date) 
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      channel.id,
      channel.snippet?.title,
      channel.snippet?.thumbnails?.default?.url,
      tokens.access_token,
      tokens.refresh_token || db.prepare("SELECT refresh_token FROM youtube_channels WHERE channel_id = ?").get(channel.id)?.refresh_token,
      tokens.expiry_date
    );

    res.send(`
      <html>
        <body>
          <script>
            window.opener.postMessage({ type: 'YOUTUBE_AUTH_SUCCESS' }, '*');
            window.close();
          </script>
          <p>YouTube Channel connected successfully! You can close this window.</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("YouTube OAuth callback error:", err);
    res.status(500).send("Authentication failed. Please try again.");
  }
});

app.get("/api/youtube/channels", requireAuth, (req, res) => {
  const channels = db.prepare("SELECT id, channel_id, title, thumbnail FROM youtube_channels WHERE user_id = ?").all(req.session.user.id);
  res.json(channels);
});

app.delete("/api/youtube/channels/:id", requireAuth, (req, res) => {
  db.prepare("DELETE FROM youtube_channels WHERE id = ? AND user_id = ?").run(req.params.id, req.session.user.id);
  res.json({ success: true });
});

// --- Pre-encoding Pipeline ---
const encodeVideo = (mediaId: number): Promise<void> => {
  return new Promise((resolve, reject) => {
    const media = db.prepare("SELECT * FROM media WHERE id = ?").get(mediaId) as any;
    if (!media) return resolve();

    const inputPath = media.filepath;
    const outputPath = path.join(UPLOADS_DIR, `encoded_${media.filename}`);

    db.prepare("UPDATE media SET status = 'processing' WHERE id = ?").run(mediaId);

    ffmpeg(inputPath)
      .outputOptions([
        "-c:v libx264",
        "-preset fast",
        "-b:v 4000k",
        "-maxrate 4000k",
        "-bufsize 8000k",
        "-pix_fmt yuv420p",
        "-g 60",
        "-c:a aac",
        "-b:a 128k",
        "-ar 44100",
        "-movflags +faststart"
      ])
      .on("start", (commandLine) => {
        console.log("Spawned FFmpeg with command: " + commandLine);
      })
      .on("error", (err) => {
        console.error("Encoding error:", err);
        db.prepare("UPDATE media SET status = 'failed' WHERE id = ?").run(mediaId);
        resolve(); // Resolve even on error to continue queue
      })
      .on("end", () => {
        console.log("Encoding finished!");
        try {
          fs.unlinkSync(inputPath);
          fs.renameSync(outputPath, inputPath);
          db.prepare("UPDATE media SET status = 'ready', is_pre_encoded = 1 WHERE id = ?").run(mediaId);
        } catch (e) {
          console.error("Failed to swap encoded file:", e);
          db.prepare("UPDATE media SET status = 'failed' WHERE id = ?").run(mediaId);
        }
        resolve();
      })
      .save(outputPath);
  });
};

class EncodingQueue {
  private queue: number[] = [];
  private isProcessing: boolean = false;

  add(mediaId: number) {
    // Check if already in queue or processing
    const media = db.prepare("SELECT status FROM media WHERE id = ?").get(mediaId) as any;
    if (media && (media.status === 'queued' || media.status === 'processing')) {
      return;
    }

    this.queue.push(mediaId);
    db.prepare("UPDATE media SET status = 'queued' WHERE id = ?").run(mediaId);
    this.process();
  }

  private async process() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    const mediaId = this.queue.shift();
    if (mediaId) {
      console.log(`[EncodingQueue] Processing media ID: ${mediaId}. Remaining in queue: ${this.queue.length}`);
      try {
        await encodeVideo(mediaId);
      } catch (err) {
        console.error(`[EncodingQueue] Error processing media ${mediaId}:`, err);
      }
    }

    this.isProcessing = false;
    // Use setImmediate to avoid stack overflow and allow other tasks to run
    setImmediate(() => this.process());
  }

  // Resume any pending tasks on startup
  resumePending() {
    const pending = db.prepare("SELECT id FROM media WHERE status IN ('queued', 'processing')").all() as any[];
    if (pending.length > 0) {
      console.log(`[EncodingQueue] Resuming ${pending.length} pending encoding tasks...`);
      for (const item of pending) {
        this.add(item.id);
      }
    }
  }
}

const encodingQueue = new EncodingQueue();

// --- YouTube Automation Helper ---
async function getYouTubeClient(channelId: number) {
  const channel = db.prepare("SELECT * FROM youtube_channels WHERE id = ?").get(channelId) as any;
  if (!channel) throw new Error("Channel not found");

  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  auth.setCredentials({
    access_token: channel.access_token,
    refresh_token: channel.refresh_token,
    expiry_date: channel.expiry_date
  });

  // Check if token needs refresh
  if (channel.expiry_date && channel.expiry_date <= Date.now() + 60000) {
    const { credentials } = await auth.refreshAccessToken();
    db.prepare(`
      UPDATE youtube_channels 
      SET access_token = ?, expiry_date = ? 
      WHERE id = ?
    `).run(credentials.access_token, credentials.expiry_date, channelId);
  }

  return google.youtube({ version: "v3", auth });
}

async function createYouTubeBroadcast(streamId: number) {
  const stream = db.prepare("SELECT * FROM streams WHERE id = ?").get(streamId) as any;
  if (!stream || !stream.youtube_channel_id) return;

  try {
    const youtube = await getYouTubeClient(stream.youtube_channel_id);
    
    const timezone = db.prepare("SELECT value FROM settings WHERE key = 'timezone'").get() as any;
    const tz = timezone ? timezone.value : "Asia/Jakarta";
    
    let scheduledTime = getISOWithOffset(stream.start_date, stream.start_time, tz);
    
    // Ensure scheduledStartTime is not in the past
    const now = new Date();
    const scheduledDate = new Date(scheduledTime);
    if (scheduledDate <= now) {
      // Set to 10 seconds in the future to allow for processing
      scheduledTime = new Date(now.getTime() + 10000).toISOString();
    }

    let title = stream.name;
    let description = stream.description || "Live Stream via SaungStream";
    let tags = stream.youtube_tags;
    let thumbnailUrl = stream.thumbnail_path || null;

    if (stream.use_ai_metadata && stream.start_date && stream.start_time) {
      const date = new Date(`${stream.start_date}T${stream.start_time}:00`);
      const metadata = getMetadataForTime(stream.user_id, date, tz, true);
      if (metadata) {
        title = metadata.title;
        description = metadata.description;
        tags = metadata.tags || tags;
        thumbnailUrl = metadata.thumbnail_url;
      }
    }

    // Map resolution
    let youtubeResolution = "720p";
    if (stream.resolution) {
      if (stream.resolution.includes("1080")) youtubeResolution = "1080p";
      else if (stream.resolution.includes("720")) youtubeResolution = "720p";
      else if (stream.resolution.includes("480")) youtubeResolution = "480p";
      else if (stream.resolution.includes("360")) youtubeResolution = "360p";
      else if (stream.resolution.includes("1440")) youtubeResolution = "1440p";
      else if (stream.resolution.includes("2160")) youtubeResolution = "2160p";
    }

    console.log(`Creating YouTube Broadcast: ${title} at ${scheduledTime} with ${youtubeResolution}`);

    // 1. Create Broadcast
    let broadcastRes;
    try {
      broadcastRes = await youtube.liveBroadcasts.insert({
        part: ["snippet", "status", "contentDetails"],
        requestBody: {
          snippet: {
            title: title,
            scheduledStartTime: scheduledTime,
            description: description
          },
          status: {
            privacyStatus: "public",
            selfDeclaredMadeForKids: stream.youtube_made_for_kids === 1
          },
          contentDetails: {
            enableAutoStart: true,
            enableAutoStop: true,
            enableEmbed: stream.youtube_allow_embedding === 1,
            monitorStream: { enableMonitorStream: false }
          }
        }
      });
    } catch (err: any) {
      // If embedding is not allowed, try again without it
      if (err.message && err.message.includes("Embed setting was invalid")) {
        console.log("YouTube embedding not allowed for this account, retrying without it...");
        broadcastRes = await youtube.liveBroadcasts.insert({
          part: ["snippet", "status", "contentDetails"],
          requestBody: {
            snippet: {
              title: title,
              scheduledStartTime: scheduledTime,
              description: description
            },
            status: {
              privacyStatus: "public",
              selfDeclaredMadeForKids: stream.youtube_made_for_kids === 1
            },
            contentDetails: {
              enableAutoStart: true,
              enableAutoStop: true,
              enableEmbed: false,
              monitorStream: { enableMonitorStream: false }
            }
          }
        });
      } else {
        throw err;
      }
    }

    const broadcastId = broadcastRes.data.id;

    // Update the video metadata (tags, category, etc.)
    await youtube.videos.update({
      part: ["snippet", "status", "recordingDetails", "contentDetails"],
      requestBody: {
        id: broadcastId!,
        snippet: {
          title: title,
          description: description,
          categoryId: stream.youtube_category || "10",
          tags: tags ? tags.split(",").map((t: string) => t.trim()) : [],
          defaultLanguage: stream.youtube_language || "id",
          defaultAudioLanguage: stream.youtube_language || "id"
        },
        status: {
          selfDeclaredMadeForKids: stream.youtube_made_for_kids === 1,
          publishAt: stream.youtube_publish_to_subscriptions === 1 ? null : undefined 
        },
        recordingDetails: {
          recordingDate: stream.youtube_recording_date ? new Date(stream.youtube_recording_date).toISOString() : undefined,
          locationDescription: stream.youtube_recording_location
        },
        contentDetails: {
          hasAlteredContent: stream.youtube_altered_content === 1
        }
      } as any
    });

    // Upload thumbnail if available
    if (thumbnailUrl) {
      try {
        const thumbPath = path.join(THUMBNAILS_DIR, thumbnailUrl);
        if (fs.existsSync(thumbPath)) {
          await youtube.thumbnails.set({
            videoId: broadcastId!,
            media: {
              body: fs.createReadStream(thumbPath)
            }
          });
        }
      } catch (thumbErr) {
        console.error("Failed to upload thumbnail to YouTube:", thumbErr);
      }
    }

    // Handle playlists
    if (stream.youtube_playlists) {
      try {
        const playlistIds = JSON.parse(stream.youtube_playlists);
        if (Array.isArray(playlistIds)) {
          for (const playlistId of playlistIds) {
            await youtube.playlistItems.insert({
              part: ["snippet"],
              requestBody: {
                snippet: {
                  playlistId: playlistId,
                  resourceId: {
                    kind: "youtube#video",
                    videoId: broadcastId!
                  }
                }
              }
            });
          }
        }
      } catch (e) {
        console.error("Failed to add video to playlists:", e);
      }
    }

    // 2. Create Stream
    const streamRes = await youtube.liveStreams.insert({
      part: ["snippet", "cdn", "contentDetails"],
      requestBody: {
        snippet: { title: title },
        cdn: {
          frameRate: "30fps",
          ingestionType: "rtmp",
          resolution: youtubeResolution
        }
      }
    });

    const youtubeStreamId = streamRes.data.id;
    const rtmpUrl = streamRes.data.cdn?.ingestionInfo?.ingestionAddress;
    const streamKey = streamRes.data.cdn?.ingestionInfo?.streamName;

    // 3. Bind
    await youtube.liveBroadcasts.bind({
      id: broadcastId!,
      part: ["id", "contentDetails"],
      streamId: youtubeStreamId!
    });

    db.prepare(`
      UPDATE streams 
      SET broadcast_id = ?, youtube_stream_id = ?, rtmp_url = ?, stream_key = ? 
      WHERE id = ?
    `).run(broadcastId, youtubeStreamId, rtmpUrl, streamKey, streamId);

    console.log(`YouTube Broadcast bound: ${broadcastId} with stream ${youtubeStreamId}`);

    return { rtmpUrl, streamKey };
  } catch (err: any) {
    const detailedError = err.response?.data?.error || err;
    console.error("Failed to automate YouTube broadcast:", JSON.stringify(detailedError, null, 2));
    throw err;
  }
}

// Auth
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as any;
  
  if (!user) {
    return res.status(401).json({ error: "Invalid password/username" });
  }

  // Check lockout
  if (user.lockout_until && new Date(user.lockout_until) > new Date()) {
    const remaining = Math.ceil((new Date(user.lockout_until).getTime() - new Date().getTime()) / 1000);
    return res.status(403).json({ error: `Too many attempts. Please wait ${remaining} seconds.` });
  }

  if (bcrypt.compareSync(password, user.password)) {
    if (user.status !== 'active') {
      return res.status(403).json({ error: "Account is inactive" });
    }
    // Reset attempts
    db.prepare("UPDATE users SET login_attempts = 0, lockout_until = NULL WHERE id = ?").run(user.id);
    req.session.user = { id: user.id, username: user.username, role: user.role };
    const { password: _, ...userWithoutPassword } = user;
    res.json({ success: true, user: userWithoutPassword });
  } else {
    const attempts = (user.login_attempts || 0) + 1;
    let lockoutUntil = null;
    if (attempts >= 10) {
      lockoutUntil = new Date(Date.now() + 30000).toISOString();
    }
    db.prepare("UPDATE users SET login_attempts = ?, lockout_until = ? WHERE id = ?").run(attempts, lockoutUntil, user.id);
    res.status(401).json({ error: "Invalid password/username" });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// --- CHUNKED UPLOAD ENDPOINTS ---
app.post("/api/upload-chunk", requireAuth, (req, res) => {
  const { chunkIndex, totalChunks, fileId } = req.query;
  const chunkDir = path.join(CHUNKS_DIR, fileId as string);
  
  if (!fs.existsSync(chunkDir)) {
    fs.mkdirSync(chunkDir, { recursive: true });
  }

  const chunkPath = path.join(chunkDir, chunkIndex as string);
  const writeStream = fs.createWriteStream(chunkPath);
  
  req.pipe(writeStream);

  writeStream.on("finish", () => {
    res.json({ success: true, message: `Chunk ${chunkIndex} uploaded` });
  });

  writeStream.on("error", (err) => {
    console.error("Chunk upload error:", err);
    res.status(500).json({ success: false, message: "Chunk upload failed" });
  });
});

app.post("/api/merge-chunks", requireAuth, async (req, res) => {
  const { fileName, fileId, totalChunks } = req.body;
  const chunkDir = path.join(CHUNKS_DIR, fileId);
  const finalPath = path.join(UPLOADS_DIR, fileName);
  
  // Increase timeout for large file merges
  req.setTimeout(0);
  
  console.log(`Starting merge for ${fileName} (${totalChunks} chunks)`);
  
  try {
    const writeStream = fs.createWriteStream(finalPath);
    const chunksCount = parseInt(totalChunks as string);
    
    // Sequential merge using streams to keep memory usage low
    for (let i = 0; i < chunksCount; i++) {
      const chunkPath = path.join(chunkDir, i.toString());
      if (fs.existsSync(chunkPath)) {
        await new Promise((resolve, reject) => {
          const readStream = fs.createReadStream(chunkPath);
          readStream.pipe(writeStream, { end: false });
          readStream.on("end", () => {
            try {
              fs.unlinkSync(chunkPath); // Delete chunk after merging
            } catch (e) {
              console.warn(`Failed to delete chunk ${i}:`, e);
            }
            resolve(true);
          });
          readStream.on("error", reject);
        });
      } else {
        console.warn(`Chunk ${i} missing for ${fileName}`);
      }
    }
    
    writeStream.end();
    
    await new Promise((resolve, reject) => {
      writeStream.on("finish", () => resolve(true));
      writeStream.on("error", reject);
    });

    console.log(`Merge finished for ${fileName}`);
    if (fs.existsSync(chunkDir)) {
      try {
        fs.rmSync(chunkDir, { recursive: true, force: true }); // Delete chunk directory
      } catch (e) {}
    }

    // Get file size
    const stats = fs.statSync(finalPath);
    const size = stats.size;

    // Generate thumbnail and get duration
    const thumbnailName = fileName + ".jpg";
    
    ffmpeg(finalPath)
      .screenshots({
        timestamps: ["00:00:01"],
        filename: thumbnailName,
        folder: THUMBNAILS_DIR,
        size: "320x180"
      })
      .on("end", () => {
        ffmpeg.ffprobe(finalPath, (err, metadata) => {
          const duration = metadata?.format?.duration || 0;
          
          // Add to database
          const result = db.prepare(
            "INSERT INTO media (user_id, filename, filepath, duration, thumbnail_path, size, status) VALUES (?, ?, ?, ?, ?, ?, ?)"
          ).run(req.session.user!.id, fileName, finalPath, Math.round(duration), thumbnailName, size, "ready");

          const mediaId = Number(result.lastInsertRowid);
          
          logAction(req.session.user!.id, req.session.user!.username, "Media Uploaded (Chunked)", `Uploaded ${fileName} (${(size / 1024 / 1024).toFixed(2)} MB)`);
          
          // Add to encoding queue
          encodingQueue.add(mediaId);

          if (!res.headersSent) {
            res.json({ 
              success: true, 
              mediaId,
              url: `/uploads/${fileName}`,
              message: "File uploaded and merged successfully" 
            });
          }
        });
      })
      .on("error", (err) => {
        console.error("FFmpeg error during merge processing:", err);
        // Still add to DB even if thumbnail fails, but with error status or no thumbnail
        const result = db.prepare(
          "INSERT INTO media (user_id, filename, filepath, size, status) VALUES (?, ?, ?, ?, ?)"
        ).run(req.session.user!.id, fileName, finalPath, size, "ready");
        
        const mediaId = Number(result.lastInsertRowid);
        encodingQueue.add(mediaId);

        if (!res.headersSent) {
          res.json({ 
            success: true, 
            mediaId,
            url: `/uploads/${fileName}`,
            message: "File uploaded but thumbnail generation failed" 
          });
        }
      });

  } catch (error) {
    console.error("Merge error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to merge file chunks: " + (error instanceof Error ? error.message : String(error)) });
    }
  }
});

app.get("/api/me", (req, res) => {
  if (req.session.user) {
    const user = db.prepare("SELECT id, username, role, status, storage_limit, profile_picture, expires_at, created_at FROM users WHERE id = ?").get(req.session.user.id) as any;
    res.json({ user });
  } else {
    res.json({ user: null });
  }
});

// Profile Picture Upload
const profileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, PROFILES_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `profile-${Date.now()}${ext}`);
  }
});
const uploadProfile = multer({ storage: profileStorage });

const thumbnailStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, THUMBNAILS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `thumb-${Date.now()}${ext}`);
  }
});
const uploadThumbnail = multer({ storage: thumbnailStorage });

app.post("/api/me/profile", requireAuth, uploadProfile.single("profile"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  
  const profilePath = `/profiles/${req.file.filename}`;
  db.prepare("UPDATE users SET profile_picture = ? WHERE id = ?").run(profilePath, req.session.user.id);
  res.json({ success: true, profile_picture: profilePath });
});

app.post("/api/streams/thumbnail/upload", requireAuth, uploadThumbnail.single("thumbnail"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  res.json({ filepath: req.file.filename });
});

app.put("/api/me", requireAuth, (req, res) => {
  const { username, password } = req.body;
  if (password) {
    const hashedPassword = bcrypt.hashSync(password, 10);
    db.prepare("UPDATE users SET username = ?, password = ? WHERE id = ?").run(username, hashedPassword, req.session.user.id);
  } else {
    db.prepare("UPDATE users SET username = ? WHERE id = ?").run(username, req.session.user.id);
  }
  // Update session user info
  req.session.user.username = username;
  res.json({ success: true });
});

// Media
app.post("/api/media/upload", requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const user = db.prepare("SELECT storage_limit FROM users WHERE id = ?").get(userId) as any;
  const mediaUsage = db.prepare("SELECT SUM(size) as total_size FROM media WHERE user_id = ?").get(userId) as any;
  const totalUsage = mediaUsage.total_size || 0;
  const limitBytes = (user.storage_limit || 10) * 1024 * 1024 * 1024;

  const contentLength = parseInt(req.headers['content-length'] || '0');
  if (contentLength > 0 && totalUsage + contentLength > limitBytes) {
    return res.status(400).json({ error: "Storage limit exceeded. Your storage is full." });
  }

  const bb = Busboy({ headers: req.headers });
  let fileProcessed = false;

  bb.on('file', (name, file, info) => {
    const { filename, encoding, mimeType } = info;
    if (name !== 'file') {
      file.resume();
      return;
    }

    fileProcessed = true;
    const saveTo = path.join(UPLOADS_DIR, filename);
    const writeStream = fs.createWriteStream(saveTo);
    let fileSize = 0;

    file.on('data', (data) => {
      fileSize += data.length;
      // Optional: Real-time storage check
      if (totalUsage + fileSize > limitBytes) {
        writeStream.destroy();
        file.resume();
        if (!res.headersSent) {
          res.status(400).json({ error: "Storage limit exceeded during upload." });
        }
        try { fs.unlinkSync(saveTo); } catch (e) {}
      }
    });

    file.pipe(writeStream);

    writeStream.on('finish', () => {
      if (res.headersSent) return;

      const thumbnailName = filename + ".jpg";
      const filepath = saveTo;

      ffmpeg(filepath)
        .screenshots({
          timestamps: ["00:00:01"],
          filename: thumbnailName,
          folder: THUMBNAILS_DIR,
          size: "320x180"
        })
        .on("end", () => {
          ffmpeg.ffprobe(filepath, (err, metadata) => {
            const duration = metadata?.format?.duration || 0;
            const result = db.prepare("INSERT INTO media (user_id, filename, filepath, duration, thumbnail_path, size, status) VALUES (?, ?, ?, ?, ?, ?, ?)")
              .run(userId, filename, filepath, Math.round(duration), thumbnailName, fileSize, 'ready');
            logAction(userId, req.session.user.username, "Media Uploaded", `Uploaded ${filename} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
            
            encodingQueue.add(Number(result.lastInsertRowid));
            res.json({ success: true });
          });
        })
        .on("error", (err) => {
          console.error("FFmpeg error during upload processing:", err);
          res.status(500).json({ error: "Failed to process video thumbnails" });
        });
    });

    writeStream.on('error', (err) => {
      console.error("Write stream error:", err);
      if (!res.headersSent) res.status(500).json({ error: "Failed to write file to disk" });
    });
  });

  bb.on('error', (err) => {
    console.error("Busboy error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Upload failed" });
  });

  bb.on('finish', () => {
    if (!fileProcessed && !res.headersSent) {
      res.status(400).json({ error: "No file uploaded" });
    }
  });

  req.pipe(bb);
});

app.get("/api/user/storage", requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const user = db.prepare("SELECT storage_limit FROM users WHERE id = ?").get(userId) as any;
  if (!user) return res.status(404).json({ error: "User not found" });
  
  const media = db.prepare("SELECT SUM(size) as total_size FROM media WHERE user_id = ?").get(userId) as any;
  
  const totalSize = media.total_size || 0;
  const limitBytes = (user.storage_limit || 10) * 1024 * 1024 * 1024;
  const percentage = Math.min(100, (totalSize / limitBytes) * 100);
  
  res.json({
    used: totalSize,
    limit: limitBytes,
    percentage: parseFloat(percentage.toFixed(2))
  });
});

app.get("/api/media", requireAuth, (req, res) => {
  let media;
  if (req.session.user.role === 'admin') {
    media = db.prepare("SELECT * FROM media ORDER BY created_at DESC").all();
  } else {
    media = db.prepare("SELECT * FROM media WHERE user_id = ? ORDER BY created_at DESC").all(req.session.user.id);
  }
  res.json(media);
});

app.post("/api/media/:id/encode", requireAuth, (req, res) => {
  const media = db.prepare("SELECT * FROM media WHERE id = ? AND user_id = ?").get(req.params.id, req.session.user.id) as any;
  if (!media) return res.status(404).json({ error: "Media not found" });
  
  if (media.status === 'processing') {
    return res.status(400).json({ error: "Media is already being processed" });
  }

  db.prepare("UPDATE media SET status = 'processing' WHERE id = ?").run(media.id);
  encodingQueue.add(media.id);
  
  res.json({ success: true, message: "Encoding started" });
});

app.get("/api/media/:id/stream", requireAuth, (req, res) => {
  const media = db.prepare("SELECT * FROM media WHERE id = ? AND user_id = ?").get(req.params.id, req.session.user.id) as any;
  if (!media || !fs.existsSync(media.filepath)) return res.status(404).json({ error: "Not found" });

  const stat = fs.statSync(media.filepath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(media.filepath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(200, head);
    fs.createReadStream(media.filepath).pipe(res);
  }
});

app.delete("/api/media/:id", requireAuth, (req, res) => {
  const media = db.prepare("SELECT * FROM media WHERE id = ?").get(req.params.id) as any;
  if (media) {
    if (fs.existsSync(media.filepath)) fs.unlinkSync(media.filepath);
    if (media.thumbnail_path && fs.existsSync(path.join(THUMBNAILS_DIR, media.thumbnail_path))) {
      fs.unlinkSync(path.join(THUMBNAILS_DIR, media.thumbnail_path));
    }
    db.prepare("DELETE FROM media WHERE id = ?").run(req.params.id);
  }
  res.json({ success: true });
});

// Playlists
app.get("/api/playlists", requireAuth, (req, res) => {
  const playlists = db.prepare("SELECT * FROM playlists WHERE user_id = ? ORDER BY created_at DESC").all(req.session.user.id);
  res.json(playlists);
});

app.post("/api/playlists", requireAuth, (req, res) => {
  const { name, loop } = req.body;
  const result = db.prepare("INSERT INTO playlists (user_id, name, loop) VALUES (?, ?, ?)").run(req.session.user.id, name, loop ? 1 : 0);
  res.json({ id: result.lastInsertRowid });
});

app.get("/api/playlists/:id", requireAuth, (req, res) => {
  const playlist = db.prepare("SELECT * FROM playlists WHERE id = ? AND user_id = ?").get(req.params.id, req.session.user.id) as any;
  if (!playlist) return res.status(404).json({ error: "Not found" });
  
  const items = db.prepare(`
    SELECT pi.*, m.filename, m.duration, m.thumbnail_path 
    FROM playlist_items pi 
    JOIN media m ON pi.media_id = m.id 
    WHERE pi.playlist_id = ? 
    ORDER BY pi.order_index ASC
  `).all(req.params.id);
  
  res.json({ ...playlist, items });
});

app.post("/api/playlists/:id/items", requireAuth, (req, res) => {
  const { media_id, order_index } = req.body;
  // Verify ownership
  const playlist = db.prepare("SELECT id FROM playlists WHERE id = ? AND user_id = ?").get(req.params.id, req.session.user.id);
  if (!playlist) return res.status(404).json({ error: "Playlist not found" });

  db.prepare("INSERT INTO playlist_items (playlist_id, media_id, order_index) VALUES (?, ?, ?)")
    .run(req.params.id, media_id, order_index);
  res.json({ success: true });
});

app.delete("/api/playlists/:id/items/:itemId", requireAuth, (req, res) => {
  const playlist = db.prepare("SELECT id FROM playlists WHERE id = ? AND user_id = ?").get(req.params.id, req.session.user.id);
  if (!playlist) return res.status(404).json({ error: "Playlist not found" });

  db.prepare("DELETE FROM playlist_items WHERE id = ? AND playlist_id = ?")
    .run(req.params.itemId, req.params.id);
  res.json({ success: true });
});

app.delete("/api/playlists/:id", requireAuth, (req, res) => {
  db.prepare("DELETE FROM playlists WHERE id = ? AND user_id = ?").run(req.params.id, req.session.user.id);
  res.json({ success: true });
});

app.get("/api/metadata/fetch", requireAuth, (req, res) => {
  const { date, time } = req.query;
  if (!date || !time) return res.status(400).json({ error: "Date and time are required" });

  try {
    const timezone = db.prepare("SELECT value FROM settings WHERE key = 'timezone'").get() as any;
    const tz = timezone ? timezone.value : "Asia/Jakarta";
    
    const targetDate = new Date(`${date}T${time}:00`);
    const metadata = getMetadataForTime(req.session.user.id, targetDate, tz, true);
    
    res.json(metadata || { title: "", description: "", topic: "" });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch metadata" });
  }
});

// Streams
app.get("/api/streams", requireAuth, (req, res) => {
  let query = `
    SELECT s.*, p.name as playlist_name, m.filename as video_name
    FROM streams s 
    LEFT JOIN playlists p ON s.playlist_id = p.id 
    LEFT JOIN media m ON s.video_id = m.id
  `;
  
  let streams;
  if (req.session.user.role === 'admin') {
    streams = db.prepare(query + " ORDER BY s.created_at DESC").all();
  } else {
    streams = db.prepare(query + " WHERE s.user_id = ? ORDER BY s.created_at DESC").all(req.session.user.id);
  }
  res.json(streams);
});

app.post("/api/streams", requireAuth, (req, res) => {
  try {
    const { 
      name, description, source_type, playlist_id, video_id, platform, youtube_channel_id, 
      rtmp_url, stream_key, bitrate, resolution, loop, duration, start_time, start_date, 
      repeat_type, repeat_days, repeat_date, schedule_enabled, use_ai_metadata,
      youtube_playlists, youtube_made_for_kids, youtube_age_restriction, youtube_paid_promotion,
      youtube_altered_content, youtube_automatic_chapters, youtube_featured_places,
      youtube_automatic_concepts, youtube_tags, youtube_language, youtube_caption_certification,
      youtube_title_description_language, youtube_recording_date, youtube_recording_location,
      youtube_license, youtube_allow_embedding, youtube_publish_to_subscriptions,
      youtube_shorts_remixing, youtube_category, youtube_comments_mode,
      youtube_who_can_comment, youtube_sort_by, network_optimization, force_encoding,
      thumbnail_path
    } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: "Stream name is required" });
    }

    const result = db.prepare(`
      INSERT INTO streams (
        user_id, name, description, source_type, playlist_id, video_id, platform, 
        youtube_channel_id, rtmp_url, stream_key, bitrate, resolution, loop, duration, 
        start_time, start_date, repeat_type, repeat_days, repeat_date, schedule_enabled, 
        use_ai_metadata, youtube_playlists, youtube_made_for_kids, youtube_age_restriction, 
        youtube_paid_promotion, youtube_altered_content, youtube_automatic_chapters, 
        youtube_featured_places, youtube_automatic_concepts, youtube_tags, youtube_language, 
        youtube_caption_certification, youtube_title_description_language, youtube_recording_date, 
        youtube_recording_location, youtube_license, youtube_allow_embedding, 
        youtube_publish_to_subscriptions, youtube_shorts_remixing, youtube_category, 
        youtube_comments_mode, youtube_who_can_comment, youtube_sort_by, network_optimization,
        force_encoding, thumbnail_path
      ) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.session.user.id, 
      name, 
      description,
      source_type || 'playlist', 
      playlist_id || null, 
      video_id || null, 
      platform || 'youtube', 
      youtube_channel_id || null, 
      rtmp_url, 
      stream_key, 
      bitrate || 6000, 
      resolution || '1920x1080', 
      loop ? 1 : 0, 
      duration || -1, 
      start_time, 
      start_date, 
      repeat_type || 'none', 
      repeat_days, 
      repeat_date, 
      schedule_enabled ? 1 : 0,
      use_ai_metadata !== undefined ? (use_ai_metadata ? 1 : 0) : 1,
      youtube_playlists ? JSON.stringify(youtube_playlists) : null,
      youtube_made_for_kids ? 1 : 0,
      youtube_age_restriction ? 1 : 0,
      youtube_paid_promotion ? 1 : 0,
      youtube_altered_content ? 1 : 0,
      youtube_automatic_chapters !== undefined ? (youtube_automatic_chapters ? 1 : 0) : 1,
      youtube_featured_places !== undefined ? (youtube_featured_places ? 1 : 0) : 1,
      youtube_automatic_concepts !== undefined ? (youtube_automatic_concepts ? 1 : 0) : 1,
      youtube_tags,
      youtube_language || 'id',
      youtube_caption_certification,
      youtube_title_description_language || 'id',
      youtube_recording_date,
      youtube_recording_location,
      youtube_license || 'youtube',
      youtube_allow_embedding !== undefined ? (youtube_allow_embedding ? 1 : 0) : 1,
      youtube_publish_to_subscriptions !== undefined ? (youtube_publish_to_subscriptions ? 1 : 0) : 1,
      youtube_shorts_remixing || 'allow_video_audio',
      youtube_category || '10',
      youtube_comments_mode || 'on',
      youtube_who_can_comment || 'anyone',
      youtube_sort_by || 'top',
      network_optimization !== undefined ? (network_optimization ? 1 : 0) : 1,
      force_encoding !== undefined ? (force_encoding ? 1 : 0) : 1,
      thumbnail_path || null
    );

    // Mark metadata slot as used if applicable
    if (use_ai_metadata && start_date && start_time) {
      try {
        const settings = db.prepare("SELECT value FROM settings WHERE key = 'timezone'").get() as any;
        const tz = settings?.value || 'UTC';
        const date = new Date(`${start_date}T${start_time}:00`);
        getMetadataForTime(req.session.user.id, date, tz, true); // true = mark as used
      } catch (e) {
        console.error("Failed to mark metadata slot as used:", e);
      }
    }
    
    logAction(req.session.user.id, req.session.user.username, "Stream Created", `Created stream: ${name}`);
    
    const newStreamId = Number(result.lastInsertRowid);
    
    // Auto-schedule on YouTube if applicable
    if (platform === 'youtube' && youtube_channel_id && schedule_enabled) {
      createYouTubeBroadcast(newStreamId).catch(err => {
        console.error("Failed to auto-schedule YouTube broadcast on creation:", err);
      });
    }

    res.json({ id: newStreamId });
  } catch (err) {
    console.error("Error creating stream:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create stream" });
  }
});

app.put("/api/streams/:id", requireAuth, (req, res) => {
  try {
    const { 
      name, description, source_type, playlist_id, video_id, platform, youtube_channel_id, 
      rtmp_url, stream_key, bitrate, resolution, loop, duration, start_time, start_date, 
      repeat_type, repeat_days, repeat_date, schedule_enabled, use_ai_metadata,
      youtube_playlists, youtube_made_for_kids, youtube_age_restriction, youtube_paid_promotion,
      youtube_altered_content, youtube_automatic_chapters, youtube_featured_places,
      youtube_automatic_concepts, youtube_tags, youtube_language, youtube_caption_certification,
      youtube_title_description_language, youtube_recording_date, youtube_recording_location,
      youtube_license, youtube_allow_embedding, youtube_publish_to_subscriptions,
      youtube_shorts_remixing, youtube_category, youtube_comments_mode,
      youtube_who_can_comment, youtube_sort_by, network_optimization, force_encoding,
      thumbnail_path
    } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: "Stream name is required" });
    }

    db.prepare(`
      UPDATE streams 
      SET name = ?, description = ?, source_type = ?, playlist_id = ?, video_id = ?, platform = ?, 
          youtube_channel_id = ?, rtmp_url = ?, stream_key = ?, bitrate = ?, resolution = ?, 
          loop = ?, duration = ?, start_time = ?, start_date = ?, repeat_type = ?, 
          repeat_days = ?, repeat_date = ?, schedule_enabled = ?, use_ai_metadata = ?,
          youtube_playlists = ?, youtube_made_for_kids = ?, youtube_age_restriction = ?, 
          youtube_paid_promotion = ?, youtube_altered_content = ?, youtube_automatic_chapters = ?, 
          youtube_featured_places = ?, youtube_automatic_concepts = ?, youtube_tags = ?, 
          youtube_language = ?, youtube_caption_certification = ?, 
          youtube_title_description_language = ?, youtube_recording_date = ?, 
          youtube_recording_location = ?, youtube_license = ?, youtube_allow_embedding = ?, 
          youtube_publish_to_subscriptions = ?, youtube_shorts_remixing = ?, youtube_category = ?, 
          youtube_comments_mode = ?, youtube_who_can_comment = ?, youtube_sort_by = ?,
          network_optimization = ?, force_encoding = ?, thumbnail_path = ?
      WHERE id = ? AND user_id = ?
    `).run(
      name, 
      description,
      source_type || 'playlist', 
      playlist_id || null, 
      video_id || null, 
      platform || 'youtube', 
      youtube_channel_id || null, 
      rtmp_url, 
      stream_key, 
      bitrate || 6000, 
      resolution || '1920x1080', 
      loop ? 1 : 0, 
      duration || -1, 
      start_time, 
      start_date, 
      repeat_type || 'none', 
      repeat_days, 
      repeat_date, 
      schedule_enabled ? 1 : 0,
      use_ai_metadata !== undefined ? (use_ai_metadata ? 1 : 0) : 1,
      youtube_playlists ? JSON.stringify(youtube_playlists) : null,
      youtube_made_for_kids ? 1 : 0,
      youtube_age_restriction ? 1 : 0,
      youtube_paid_promotion ? 1 : 0,
      youtube_altered_content ? 1 : 0,
      youtube_automatic_chapters !== undefined ? (youtube_automatic_chapters ? 1 : 0) : 1,
      youtube_featured_places !== undefined ? (youtube_featured_places ? 1 : 0) : 1,
      youtube_automatic_concepts !== undefined ? (youtube_automatic_concepts ? 1 : 0) : 1,
      youtube_tags,
      youtube_language || 'id',
      youtube_caption_certification,
      youtube_title_description_language || 'id',
      youtube_recording_date,
      youtube_recording_location,
      youtube_license || 'youtube',
      youtube_allow_embedding !== undefined ? (youtube_allow_embedding ? 1 : 0) : 1,
      youtube_publish_to_subscriptions !== undefined ? (youtube_publish_to_subscriptions ? 1 : 0) : 1,
      youtube_shorts_remixing || 'allow_video_audio',
      youtube_category || '10',
      youtube_comments_mode || 'on',
      youtube_who_can_comment || 'anyone',
      youtube_sort_by || 'top',
      network_optimization !== undefined ? (network_optimization ? 1 : 0) : 1,
      force_encoding !== undefined ? (force_encoding ? 1 : 0) : 1,
      thumbnail_path || null,
      req.params.id,
      req.session.user.id
    );

    // Re-schedule on YouTube if applicable and not already scheduled/live
    const streamId = Number(req.params.id);
    const updatedStream = db.prepare("SELECT * FROM streams WHERE id = ?").get(streamId) as any;
    if (platform === 'youtube' && youtube_channel_id && schedule_enabled && !updatedStream.broadcast_id) {
      createYouTubeBroadcast(streamId).catch(err => {
        console.error("Failed to auto-schedule YouTube broadcast on update:", err);
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error updating stream:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update stream" });
  }
});

app.post("/api/streams/:id/start", requireAuth, async (req, res) => {
  const stream = db.prepare("SELECT name, start_time, start_date FROM streams WHERE id = ? AND user_id = ?").get(req.params.id, req.session.user.id) as any;
  if (!stream) return res.status(404).json({ error: "Stream not found" });
  
  // Update last_triggered to prevent scheduler from picking it up in the same minute
  const timezone = db.prepare("SELECT value FROM settings WHERE key = 'timezone'").get() as any;
  const tz = timezone ? timezone.value : "Asia/Jakarta";
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(now);
  const dateParts: any = {};
  parts.forEach(p => dateParts[p.type] = p.value);
  const triggerKey = `${dateParts.year}-${dateParts.month}-${dateParts.day} ${dateParts.hour}:${dateParts.minute}`;
  db.prepare("UPDATE streams SET last_triggered = ? WHERE id = ?").run(triggerKey, req.params.id);

  try {
    const result = await streamManager.startStream(Number(req.params.id));
    if (result && !result.success) {
      return res.status(500).json({ error: result.error });
    }
    
    logAction(req.session.user.id, req.session.user.username, "Stream Started", `Started stream: ${stream.name}`);
    res.json({ success: true });
  } catch (err: any) {
    console.error(`Manual start failed for stream ${req.params.id}:`, err);
    res.status(500).json({ error: err.message || "Failed to start stream" });
  }
});

app.post("/api/streams/:id/stop", requireAuth, (req, res) => {
  const stream = db.prepare("SELECT name FROM streams WHERE id = ? AND user_id = ?").get(req.params.id, req.session.user.id) as any;
  if (!stream) return res.status(404).json({ error: "Stream not found" });
  streamManager.stopStream(Number(req.params.id));
  logAction(req.session.user.id, req.session.user.username, "Stream Stopped", `Stopped stream: ${stream.name}`);
  res.json({ success: true });
});

app.delete("/api/streams/:id", requireAuth, (req, res) => {
  const stream = db.prepare("SELECT id FROM streams WHERE id = ? AND user_id = ?").get(req.params.id, req.session.user.id);
  if (!stream) return res.status(404).json({ error: "Stream not found" });
  streamManager.stopStream(Number(req.params.id));
  db.prepare("DELETE FROM streams WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

// Logs
app.get("/api/logs", requireAuth, (req, res) => {
  let logs;
  if (req.session.user.role === 'admin') {
    logs = db.prepare("SELECT * FROM logs ORDER BY timestamp DESC LIMIT 100").all();
  } else {
    logs = db.prepare("SELECT * FROM logs WHERE user_id = ? ORDER BY timestamp DESC LIMIT 100").all(req.session.user.id);
  }
  res.json(logs);
});

// User Management
app.get("/api/users", requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare("SELECT id, username, role, status, storage_limit, profile_picture, created_at, expires_at FROM users").all();
  res.json(users);
});

app.post("/api/users", requireAuth, requireAdmin, (req, res) => {
  const { role, status, storage_limit, expires_at } = req.body;
  
  // Find next username
  const users = db.prepare("SELECT username FROM users WHERE username LIKE 'saungstream%'").all() as any[];
  let nextUsername = "saungstream";
  if (users.length > 0) {
    const indices = users.map(u => {
      if (u.username === "saungstream") return 0;
      const match = u.username.match(/saungstream-(\d+)/);
      return match ? parseInt(match[1]) : -1;
    }).filter(i => i >= 0);
    
    if (indices.length > 0) {
      const maxIndex = Math.max(...indices);
      nextUsername = `saungstream-${maxIndex + 1}`;
    } else {
      nextUsername = "saungstream-1";
    }
  }

  const defaultPassword = "123";
  const hashedPassword = bcrypt.hashSync(defaultPassword, 10);
  
  try {
    const result = db.prepare("INSERT INTO users (username, password, role, status, storage_limit, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(nextUsername, hashedPassword, role || 'member', status || 'active', storage_limit || 10, expires_at || null);
    res.json({ id: result.lastInsertRowid, username: nextUsername, password: defaultPassword });
  } catch (err) {
    res.status(400).json({ error: "Failed to create user" });
  }
});

app.put("/api/users/:id", requireAuth, requireAdmin, (req, res) => {
  const { username, role, status, storage_limit, password, expires_at } = req.body;
  if (password) {
    const hashedPassword = bcrypt.hashSync(password, 10);
    db.prepare("UPDATE users SET username = ?, role = ?, status = ?, storage_limit = ?, password = ?, expires_at = ? WHERE id = ?")
      .run(username, role, status, storage_limit, hashedPassword, expires_at || null, req.params.id);
  } else {
    db.prepare("UPDATE users SET username = ?, role = ?, status = ?, storage_limit = ?, expires_at = ? WHERE id = ?")
      .run(username, role, status, storage_limit, expires_at || null, req.params.id);
  }
  res.json({ success: true });
});

app.post("/api/users/:id/extend", requireAuth, requireAdmin, (req, res) => {
  const { months } = req.body;
  const user = db.prepare("SELECT expires_at FROM users WHERE id = ?").get(req.params.id) as any;
  if (!user) return res.status(404).json({ error: "User not found" });

  let currentExpiry = user.expires_at ? new Date(user.expires_at) : new Date();
  if (currentExpiry < new Date()) currentExpiry = new Date();

  const newExpiry = new Date(currentExpiry);
  newExpiry.setMonth(newExpiry.getMonth() + Number(months));
  
  db.prepare("UPDATE users SET expires_at = ? WHERE id = ?").run(newExpiry.toISOString(), req.params.id);
  res.json({ success: true, newExpiry: newExpiry.toISOString() });
});

app.delete("/api/users/:id", requireAuth, requireAdmin, (req, res) => {
  if (Number(req.params.id) === req.session.user.id) {
    return res.status(400).json({ error: "Cannot delete yourself" });
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

// System Stats
app.get("/api/system/time", requireAuth, (req, res) => {
  const timezone = db.prepare("SELECT value FROM settings WHERE key = 'timezone'").get() as any;
  const tz = timezone ? timezone.value : "Asia/Jakarta";
  
  // Get time in the specified timezone
  const now = new Date();
  const serverTime = now.toISOString();
  
  try {
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(now);

    res.json({ 
      serverTime,
      timezone: tz,
      formatted,
      currentTime: formatted
    });
  } catch (e) {
    console.error(`Timezone error for ${tz}:`, e);
    res.json({ 
      serverTime,
      timezone: "Asia/Jakarta",
      formatted: now.toISOString(),
      currentTime: now.toISOString()
    });
  }
});

app.post("/api/system/settings", requireAuth, requireAdmin, (req, res) => {
  const { timezone, theme_mode, gemini_api_key, github_token } = req.body;
  console.log(`Updating system settings: timezone=${timezone}, theme_mode=${theme_mode}`);
  
  if (timezone) {
    try {
      // Validate timezone
      new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('timezone', ?)").run(timezone);
    } catch (e) {
      return res.status(400).json({ error: "Invalid timezone format" });
    }
  }
  if (theme_mode) db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('theme_mode', ?)").run(theme_mode);
  if (gemini_api_key !== undefined) db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('gemini_api_key', ?)").run(gemini_api_key);
  if (github_token !== undefined) db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('github_token', ?)").run(github_token);
  
  res.json({ success: true });
});

app.get("/api/system/settings", requireAuth, (req, res) => {
  const settings = db.prepare("SELECT * FROM settings").all() as any[];
  const settingsMap = settings.reduce((acc, curr) => {
    acc[curr.key] = curr.value;
    return acc;
  }, {});
  res.json(settingsMap);
});

app.post("/api/system/settings/clear-update-flag", requireAuth, requireAdmin, (req, res) => {
  db.prepare("DELETE FROM settings WHERE key = 'last_update_success'").run();
  res.json({ success: true });
});

app.get("/api/system/update-check", requireAuth, async (req, res) => {
  try {
    // 1. Ensure remote is set correctly and fetch latest
    try {
      // Check if it's a git repo
      let isGit = false;
      try {
        await execAsync("git rev-parse --is-inside-work-tree");
        isGit = true;
      } catch (e) {
        try {
          await execAsync("git init");
          isGit = true;
        } catch (initErr) {
          console.error("Failed to initialize git:", initErr);
        }
      }

      if (isGit) {
        try {
          await execAsync("git remote set-url origin https://github.com/acnudesign/SaungStream.git");
        } catch (e) {
          try {
            await execAsync("git remote add origin https://github.com/acnudesign/SaungStream.git");
          } catch (re) {}
        }
        await execAsync("git fetch origin main");
      }
    } catch (e) {
      console.error("Fetch failed in update-check:", e);
    }

    // 2. Get current version (hash)
    let currentHash = "unknown";
    try {
      const { stdout } = await execAsync("git rev-parse --short HEAD");
      currentHash = stdout.trim();
    } catch (e) {}

    // 3. Get latest version (hash)
    let latestHash = "unknown";
    try {
      const { stdout } = await execAsync("git rev-parse --short origin/main");
      latestHash = stdout.trim();
    } catch (e) {}

    // 4. Get changelog (commits between current and latest)
    let changelog: string[] = [];
    try {
      const { stdout } = await execAsync(`git log HEAD..origin/main --oneline -n 10`);
      changelog = stdout.split("\n").filter(l => l.trim().length > 0);
      
      // If no new commits, show last 5 commits anyway for info
      if (changelog.length === 0) {
        const { stdout: lastCommits } = await execAsync(`git log -n 5 --oneline`);
        changelog = lastCommits.split("\n").filter(l => l.trim().length > 0);
      }
    } catch (e) {
      changelog = ["Could not fetch changelog"];
    }

    res.json({ 
      currentVersion: currentHash,
      latestVersion: latestHash,
      updateAvailable: latestHash !== "unknown" && (currentHash === "unknown" || currentHash !== latestHash),
      changelog: changelog,
      githubUrl: "https://github.com/acnudesign/SaungStream"
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to check for updates" });
  }
});

app.post("/api/system/update", requireAuth, requireAdmin, async (req, res) => {
  const userId = req.session.user.id;
  const username = req.session.user.username;
  
  // Get the latest hash we are updating to
  let targetHash = "unknown";
  try {
    const { stdout } = await execAsync("git rev-parse --short origin/main");
    targetHash = stdout.trim();
  } catch (e) {}

  logAction(userId, username, "System Update", `Initiated system update to version ${targetHash}`);
  
  // Store pending update info in settings
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('pending_update_hash', ?)").run(targetHash);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('pending_update_user', ?)").run(username);

  res.json({ success: true, message: "Update initiated. The server will pull changes and restart shortly." });

  // Run update in background after sending response to avoid hanging the request
  setTimeout(async () => {
    try {
      console.log("Starting background system update from GitHub...");
      
      // Get GitHub token if available
      const githubToken = db.prepare("SELECT value FROM settings WHERE key = 'github_token'").get() as any;
      const repoUrl = githubToken && githubToken.value 
        ? `https://${githubToken.value}@github.com/acnudesign/SaungStream.git`
        : "https://github.com/acnudesign/SaungStream.git";

      // 1. Check if git is initialized and ensure remote is correct
      try {
        await execAsync("git rev-parse --is-inside-work-tree");
      } catch (e) {
        await execAsync("git init");
        try {
          await execAsync("git config user.email 'update@saungstream.local'");
          await execAsync("git config user.name 'Update Bot'");
        } catch (cfgErr) {}
      }

      try {
        await execAsync(`git remote set-url origin ${repoUrl}`);
      } catch (e) {
        try {
          await execAsync(`git remote add origin ${repoUrl}`);
        } catch (re) {}
      }

      // 2. Fetch latest
      console.log("Fetching latest from GitHub...");
      await execAsync("git fetch origin main");

      // 3. Reset to force update
      console.log("Resetting local state to match GitHub...");
      try {
        await execAsync("git checkout -B main origin/main");
      } catch (e) {
        await execAsync("git reset --hard origin/main");
      }

      // 4. Install dependencies and build
      console.log("Installing dependencies...");
      try {
        // Use --no-audit and --no-fund to speed up the process
        await execAsync("npm install --no-audit --no-fund");
      } catch (e) {
        console.error("npm install failed:", e);
      }

      console.log("Building frontend assets...");
      try {
        // Ensure we are building for production
        await execAsync("NODE_ENV=production npm run build");
      } catch (e) {
        console.error("npm run build failed:", e);
      }

      console.log("Update successful, broadcasting refresh signal...");
      // Broadcast to all clients to refresh
      const io = (app as any).io;
      if (io) {
        io.emit('system:update_available', { 
          message: 'Aplikasi telah diperbarui ke versi terbaru. Memuat ulang...',
          version: new Date().getTime() 
        });
      }

      // 5. Close database connections to release file locks
      console.log("Closing database connections before restart...");
      try {
        db.close();
      } catch (e) {
        console.error("Error closing main DB:", e);
      }

      // 6. Try to rename root files to avoid git unlink errors
      const rootFiles = ["saungstream.db", "sessions.db", "saungstream.db-shm", "saungstream.db-wal"];
      rootFiles.forEach(file => {
        const p = path.join(process.cwd(), file);
        if (fs.existsSync(p)) {
          try {
            const bakPath = p + ".bak_" + Date.now();
            fs.renameSync(p, bakPath);
          } catch (e) {
            console.error(`Failed to rename root file ${file}:`, e);
          }
        }
      });

      console.log("Update completed successfully. Restarting...");
      process.exit(0);

    } catch (err: any) {
      console.error("Background update failed:", err);
      process.exit(1); 
    }
  }, 2000);
});

app.get("/api/admin/global-stats", requireAdmin, (req, res) => {
  const activeStreams = db.prepare("SELECT COUNT(*) as count FROM streams WHERE status = 'live'").get() as any;
  const totalMedia = db.prepare("SELECT COUNT(*) as count FROM media").get() as any;
  
  const timezone = db.prepare("SELECT value FROM settings WHERE key = 'timezone'").get() as any;
  const tz = timezone ? timezone.value : "Asia/Jakarta";
  const today = new Date().toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
  
  const scheduledToday = db.prepare("SELECT COUNT(*) as count FROM streams WHERE start_date = ? AND schedule_enabled = 1").get(today) as any;
  
  res.json({
    activeStreams: activeStreams.count,
    totalMedia: totalMedia.count,
    scheduledToday: scheduledToday.count
  });
});

// Network stats tracking
let lastNetStats = { rx: 0, tx: 0, time: Date.now() };

function getNetworkStats() {
  try {
    const data = fs.readFileSync("/proc/net/dev", "utf8");
    const lines = data.split("\n");
    let totalRx = 0;
    let totalTx = 0;

    for (const line of lines) {
      if (line.includes(":") && !line.trim().startsWith("lo:")) {
        const parts = line.split(":")[1].trim().split(/\s+/);
        totalRx += parseInt(parts[0], 10);
        totalTx += parseInt(parts[8], 10);
      }
    }
    return { rx: totalRx, tx: totalTx };
  } catch (e) {
    return { rx: 0, tx: 0 };
  }
}

// Initialize network stats
lastNetStats = { ...getNetworkStats(), time: Date.now() };

app.get("/api/system/stats", requireAuth, requireAdmin, async (req, res) => {
  const cpus = os.cpus();
  const load = os.loadavg();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const disk = await checkDiskSpace(process.cwd());
  const uptime = os.uptime();

  // Calculate network throughput
  const currentNet = getNetworkStats();
  const currentTime = Date.now();
  const timeDiff = (currentTime - lastNetStats.time) / 1000; // in seconds
  
  let downloadRate = 0;
  let uploadRate = 0;

  if (timeDiff > 0) {
    downloadRate = Math.max(0, (currentNet.rx - lastNetStats.rx) / timeDiff / 1024 / 1024 * 8); // Mbps
    uploadRate = Math.max(0, (currentNet.tx - lastNetStats.tx) / timeDiff / 1024 / 1024 * 8); // Mbps
  }

  // Update last stats for next call
  lastNetStats = { ...currentNet, time: currentTime };

  // Calculate CPU usage percentage more accurately or show raw load
  const cpuUsagePercent = Math.round((load[0] / cpus.length) * 100);

  const stats = {
    cpu: {
      model: cpus[0].model,
      usage: cpuUsagePercent,
      load: load[0].toFixed(2),
      cores: cpus.length,
      speed: cpus[0].speed
    },
    memory: {
      total: Math.round(totalMem / 1024 / 1024 / 1024),
      free: Math.round(freeMem / 1024 / 1024 / 1024),
      usage: Math.round(((totalMem - freeMem) / totalMem) * 100)
    },
    disk: {
      total: Math.round(disk.size / 1024 / 1024 / 1024),
      free: Math.round(disk.free / 1024 / 1024 / 1024),
      usage: Math.round(((disk.size - disk.free) / disk.size) * 100)
    },
    network: {
      download: downloadRate.toFixed(2),
      upload: uploadRate.toFixed(2)
    },
    system: {
      platform: os.platform(),
      release: os.release(),
      uptime: Math.round(uptime / 3600), // in hours
      hostname: os.hostname()
    }
  };

  res.json(stats);
});

// AI Metadata Generator
app.get("/api/metadata-slots", requireAuth, (req, res) => {
  const slots = db.prepare("SELECT * FROM metadata_slots WHERE user_id = ? ORDER BY day_of_week ASC, slot_index ASC").all(req.session.user.id);
  res.json(slots);
});

app.post("/api/metadata-slots/init", requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const existing = db.prepare("SELECT count(*) as count FROM metadata_slots WHERE user_id = ?").get(userId) as any;
  
  if (existing.count === 0) {
    const insert = db.prepare("INSERT INTO metadata_slots (user_id, day_of_week, slot_index, title, description) VALUES (?, ?, ?, ?, ?)");
    db.transaction(() => {
      for (let day = 0; day < 7; day++) {
        for (let slot = 0; slot < 10; slot++) {
          insert.run(userId, day, slot, `Slot ${day}-${slot}`, "Description will be generated here...");
        }
      }
    })();
  }
  res.json({ success: true });
});

app.put("/api/metadata-slots/:id", requireAuth, (req, res) => {
  const { title, description, topic, thumbnail_url, last_number } = req.body;
  db.prepare("UPDATE metadata_slots SET title = ?, description = ?, topic = ?, thumbnail_url = ?, last_number = ? WHERE id = ? AND user_id = ?")
    .run(title, description, topic, thumbnail_url, last_number || 0, req.params.id, req.session.user.id);
  res.json({ success: true });
});

app.post("/api/metadata-slots/generate-day", requireAuth, async (req, res) => {
  const { dayOfWeek, topic } = req.body;
  if (dayOfWeek === undefined || !topic) return res.status(400).json({ error: "Day and Topic are required" });

  try {
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'gemini_api_key'").get() as any;
    const apiKey = setting?.value || process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
      return res.status(400).json({ error: "Gemini API Key is not configured." });
    }

    const ai = new GoogleGenAI({ apiKey });
    
    // Fetch all slots for this day
    const slots = db.prepare("SELECT id, slot_index FROM metadata_slots WHERE user_id = ? AND day_of_week = ? ORDER BY slot_index ASC")
      .all(req.session.user.id, dayOfWeek) as any[];

    if (slots.length === 0) return res.status(404).json({ error: "No slots found for this day." });

    // Generate 10 variations in one go
    const textResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Generate 10 unique YouTube stream titles, detailed descriptions, and relevant tags for a live stream about: ${topic}. 
      The variations should be suitable for different times of the day (morning, afternoon, evening).
      Return the result in JSON format as an array of 10 objects, each with keys "title", "description", and "tags".
      The tags should be a comma-separated string of highly relevant keywords for SEO, with a maximum length of 500 characters including commas.`,
      config: { responseMimeType: "application/json" }
    });

    const variations = JSON.parse(textResponse.text || "[]");
    
    if (!Array.isArray(variations) || variations.length === 0) {
      throw new Error("Invalid AI response format");
    }

    // Update each slot
    const updateStmt = db.prepare("UPDATE metadata_slots SET title = ?, description = ?, tags = ?, topic = ?, is_used = 0 WHERE id = ?");
    
    for (let i = 0; i < slots.length; i++) {
      const variation = variations[i % variations.length];
      updateStmt.run(variation.title, variation.description, variation.tags || "", topic, slots[i].id);
    }

    res.json({ success: true, count: variations.length });
  } catch (err) {
    console.error("Bulk generation error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Bulk generation failed" });
  }
});

app.post("/api/metadata-slots/reset-used", requireAuth, (req, res) => {
  try {
    db.prepare("UPDATE metadata_slots SET is_used = 0 WHERE user_id = ?").run(req.session.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to reset slots" });
  }
});
app.post("/api/metadata-slots/generate", requireAuth, async (req, res) => {
  const { slotId, topic } = req.body;
  if (!topic) return res.status(400).json({ error: "Topic is required" });

  try {
    // Get API Key from settings or env
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'gemini_api_key'").get() as any;
    const apiKey = setting?.value || process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
      return res.status(400).json({ error: "Gemini API Key is not configured. Please set it in Settings." });
    }

    const ai = new GoogleGenAI({ apiKey });
    
    // Generate Text
    const textResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Generate a catchy YouTube stream title, a detailed description, and relevant tags for a live stream about: ${topic}. 
      Return the result in JSON format with keys "title", "description", and "tags". 
      The description should be engaging and include relevant keywords.
      The tags should be a comma-separated string of highly relevant keywords for SEO, with a maximum length of 500 characters including commas.`,
      config: { responseMimeType: "application/json" }
    });

    const metadata = JSON.parse(textResponse.text || "{}");

    // Generate Thumbnail (Optional - might fail due to quota)
    let thumbnailUrl = "";
    try {
      const imageResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: {
          parts: [{ text: `A high-quality, vibrant YouTube thumbnail for a live stream about: ${topic}. No text on image, just high impact visual.` }]
        },
        config: {
          imageConfig: { aspectRatio: "16:9" }
        }
      });

      for (const part of imageResponse.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          const filename = `ai-thumb-${Date.now()}.png`;
          const filepath = path.join(THUMBNAILS_DIR, filename);
          fs.writeFileSync(filepath, Buffer.from(part.inlineData.data, "base64"));
          thumbnailUrl = filename;
          break;
        }
      }
    } catch (imageError) {
      console.error("Thumbnail generation failed (likely quota):", imageError);
      // Continue without thumbnail if it fails
    }

    if (metadata.title) {
      db.prepare("UPDATE metadata_slots SET title = ?, description = ?, tags = ?, topic = ?, thumbnail_url = ? WHERE id = ? AND user_id = ?")
        .run(metadata.title, metadata.description, metadata.tags || "", topic, thumbnailUrl, slotId, req.session.user.id);
    }

    res.json({ success: true, title: metadata.title, description: metadata.description, tags: metadata.tags, thumbnail_url: thumbnailUrl });
  } catch (err: any) {
    console.error("AI Generation failed:", err);
    res.status(500).json({ error: "AI Generation failed: " + err.message });
  }
});

// Serve static files
app.use("/thumbnails", express.static(THUMBNAILS_DIR));
app.use("/uploads", express.static(UPLOADS_DIR));
app.use("/profiles", express.static(PROFILES_DIR));

// --- Background Scheduler Engine ---
setInterval(() => {
  const timezone = db.prepare("SELECT value FROM settings WHERE key = 'timezone'").get() as any;
  const tz = timezone ? timezone.value : "Asia/Jakarta";
  
  const now = new Date();
  
  // Get time in the specified timezone
  let currentTime: string;
  let currentDate: string;
  let currentDay: string;
  let currentDayOfMonth: number;

  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short'
    });
    
    const parts = formatter.formatToParts(now);
    const dateParts: any = {};
    parts.forEach(p => dateParts[p.type] = p.value);
    
    currentTime = `${dateParts.hour}:${dateParts.minute}`;
    currentDate = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
    currentDay = dateParts.weekday.toLowerCase();
    currentDayOfMonth = parseInt(dateParts.day);
  } catch (e) {
    // Fallback to UTC if timezone is invalid
    currentTime = now.toISOString().slice(11, 16);
    currentDate = now.toISOString().slice(0, 10);
    currentDay = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][now.getDay()];
    currentDayOfMonth = now.getDate();
  }

  // Watchdog log every 10 minutes to confirm scheduler is alive
  if (now.getMinutes() % 10 === 0 && now.getSeconds() < 10) {
    console.log(`Scheduler Watchdog: Running at ${now.toISOString()}, TZ: ${tz}, Local: ${currentDate} ${currentTime} (${currentDay})`);
  }

  // 1. Check for streams to start
  const scheduledStreams = db.prepare("SELECT * FROM streams WHERE schedule_enabled = 1 AND status = 'idle' AND start_time IS NOT NULL AND start_time != ''").all() as any[];

  for (const stream of scheduledStreams) {
    let shouldStart = false;

    // Prevent double trigger in the same minute
    const triggerKey = `${currentDate} ${currentTime}`;
    if (stream.last_triggered === triggerKey) continue;

    if (stream.start_time === currentTime) {
      if (stream.repeat_type === "none" && stream.start_date === currentDate) {
        shouldStart = true;
        // Disable after run once
        db.prepare("UPDATE streams SET schedule_enabled = 0 WHERE id = ?").run(stream.id);
      } else if (stream.repeat_type === "daily") {
        shouldStart = true;
      } else if (stream.repeat_type === "weekly") {
        const days = (stream.repeat_days || "").split(",");
        if (days.includes(currentDay)) {
          shouldStart = true;
        }
      } else if (stream.repeat_type === "monthly") {
        if (stream.repeat_date === currentDayOfMonth) {
          shouldStart = true;
        }
      }
    }

    // Handle interval-based repetitions
    if (!shouldStart && ["10min", "30min", "1hour", "6hours", "12hours"].includes(stream.repeat_type)) {
      const intervalMap: any = { "10min": 10, "30min": 30, "1hour": 60, "6hours": 360, "12hours": 720 };
      const interval = intervalMap[stream.repeat_type];
      
      try {
        const [nowH, nowM] = currentTime.split(':').map(Number);
        const [startH, startM] = stream.start_time.split(':').map(Number);
        
        const startDate = new Date(stream.start_date);
        const currDate = new Date(currentDate);
        const daysDiff = Math.round((currDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysDiff >= 0) {
          const totalMinutesDiff = daysDiff * 1440 + (nowH * 60 + nowM) - (startH * 60 + startM);
          if (totalMinutesDiff >= 0 && totalMinutesDiff % interval === 0) {
            shouldStart = true;
          }
        }
      } catch (e) {
        console.error("Error calculating interval repetition:", e);
      }
    }

    if (shouldStart) {
      if (!streamManager.isLive(stream.id)) {
        db.prepare("UPDATE streams SET last_triggered = ? WHERE id = ?").run(triggerKey, stream.id);
        streamManager.startStream(stream.id);
        db.prepare("INSERT INTO logs (user_id, type, message) VALUES (?, ?, ?)")
          .run(stream.user_id, "info", `Scheduled stream trigger for ${stream.name}`);
      }
    }
  }

  // 2. Check for streams to stop (duration based)
  const liveStreams = db.prepare("SELECT id, name, user_id, started_at, duration FROM streams WHERE status = 'live' AND started_at IS NOT NULL AND duration > 0").all() as any[];
  
  for (const stream of liveStreams) {
    // SQLite CURRENT_TIMESTAMP is YYYY-MM-DD HH:MM:SS (UTC)
    // Convert to ISO 8601 format (YYYY-MM-DDTHH:MM:SSZ) for reliable parsing
    const startedAt = new Date(stream.started_at.replace(' ', 'T') + 'Z');
    const durationMs = Number(stream.duration) * 60 * 60 * 1000;
    const stopAt = new Date(startedAt.getTime() + durationMs);

    if (now >= stopAt) {
      console.log(`Auto-stopping stream ${stream.name} (ID: ${stream.id}). Started at: ${startedAt.toISOString()}, Duration: ${stream.duration}h, Stop at: ${stopAt.toISOString()}, Now: ${now.toISOString()}`);
      streamManager.stopStream(stream.id);
      db.prepare("INSERT INTO logs (user_id, type, message) VALUES (?, ?, ?)")
        .run(stream.user_id, "info", `Stream ${stream.name} stopped automatically after ${stream.duration} hours.`);
    }
  }

  // 3. Cleanup old logs (keep last 1000)
  if (now.getHours() === 0 && now.getMinutes() === 0 && now.getSeconds() < 10) {
    try {
      db.prepare("DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY timestamp DESC LIMIT 1000)").run();
      console.log("Logs cleanup completed.");
    } catch (e) {}
  }
}, 10000); // Check every 10 seconds for better accuracy

// --- Vite Setup ---
async function startServer() {
  // API catch-all (before Vite/Static middleware)
  app.get("/googlee6cc427312025889.html", (req, res) => {
    res.send("google-site-verification: googlee6cc427312025889.html");
  });

  app.all("/api/*", (req, res) => {
    res.status(404).json({ error: "API route not found" });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  const PORT = 3000;
  const httpServer = http.createServer(app);
  const io = new SocketServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // Make io available globally or pass it to routes
  (app as any).io = io;

  io.on("connection", (socket) => {
    console.log("Client connected to socket:", socket.id);
  });

  const server = httpServer.listen(PORT, "0.0.0.0", async () => {
    console.log(`SaungStream running on http://localhost:${PORT}`);
    
    // Auto-resume live streams and pending encodings on startup
    await streamManager.resumeLiveStreams();
    encodingQueue.resumePending();
  });

  // Increase timeouts for large file uploads
  server.timeout = 0; // No timeout
  server.keepAliveTimeout = 60000; // 60 seconds
  server.headersTimeout = 65000; // Slightly more than keepAliveTimeout
}

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // Log to DB if possible
  try {
    db.prepare("INSERT INTO logs (type, message) VALUES (?, ?)").run("error", `CRITICAL: Uncaught Exception: ${err.message}`);
  } catch (e) {}
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  try {
    db.prepare("INSERT INTO logs (type, message) VALUES (?, ?)").run("error", `CRITICAL: Unhandled Rejection: ${String(reason)}`);
  } catch (e) {}
});

process.on('exit', () => {
  streamManager.stopAll();
});

process.on('SIGINT', () => {
  streamManager.stopAll();
  process.exit(0);
});

process.on('SIGTERM', () => {
  streamManager.stopAll();
  process.exit(0);
});

// Memory monitoring
setInterval(() => {
  const used = process.memoryUsage();
  const msg = `Memory: RSS=${Math.round(used.rss / 1024 / 1024)}MB, Heap=${Math.round(used.heapUsed / 1024 / 1024)}MB`;
  console.log(msg);
  // Only log to DB if it's getting high
  if (used.rss > 500 * 1024 * 1024) {
    try {
      db.prepare("INSERT INTO logs (type, message) VALUES (?, ?)").run("warning", `High Memory Usage: ${msg}`);
    } catch (e) {}
  }
}, 60000);

startServer();
