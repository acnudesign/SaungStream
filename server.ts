import express from "express";
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

console.log(`Initializing directories in: ${process.cwd()}`);
[UPLOADS_DIR, THUMBNAILS_DIR, PROFILES_DIR, DATA_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
});

// Move existing DB files to data/ if they exist in root to avoid git update locks
const dbFiles = ["saungstream.db", "sessions.db", "saungstream.db-shm", "saungstream.db-wal"];
dbFiles.forEach(file => {
  const oldPath = path.join(process.cwd(), file);
  const newPath = path.join(DATA_DIR, file);
  if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
    try {
      fs.renameSync(oldPath, newPath);
      console.log(`Successfully moved ${file} to data/ folder`);
    } catch (e) {
      console.error(`Failed to move ${file} to data/ folder:`, e);
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
    rtmp_url TEXT,
    stream_key TEXT,
    bitrate INTEGER DEFAULT 3000,
    resolution TEXT DEFAULT '1280x720',
    status TEXT DEFAULT 'idle',
    last_triggered TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(playlist_id) REFERENCES playlists(id),
    FOREIGN KEY(video_id) REFERENCES media(id)
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
    user_id INTEGER,
    username TEXT,
    action TEXT,
    message TEXT,
    type TEXT DEFAULT 'info', -- info, error
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// --- Migrations ---
const migrate = () => {
  const tables = ["users", "media", "playlists", "streams", "logs"];
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
    }
    
    if (table === "streams") {
      if (!columns.includes("source_type")) db.prepare("ALTER TABLE streams ADD COLUMN source_type TEXT DEFAULT 'playlist'").run();
      if (!columns.includes("video_id")) db.prepare("ALTER TABLE streams ADD COLUMN video_id INTEGER").run();
      if (!columns.includes("platform")) db.prepare("ALTER TABLE streams ADD COLUMN platform TEXT DEFAULT 'youtube'").run();
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
        
        logAction(0, username, "System Update Success", `Update to version ${currentHash} was successful. Latest commit: ${message}`);
        
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
app.use(express.json());
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

// --- FFmpeg Stream Manager ---
// --- Logging Helper ---
const logAction = (userId: number, username: string, action: string, message: string, type: string = 'info') => {
  db.prepare("INSERT INTO logs (user_id, username, action, message, type) VALUES (?, ?, ?, ?, ?)")
    .run(userId, username, action, message, type);
};

class StreamManager {
  private activeStreams: Map<number, ChildProcess> = new Map();

  startStream(streamId: number) {
    if (this.activeStreams.has(streamId)) return;

    const stream = db.prepare(`
      SELECT s.*, p.loop as playlist_loop 
      FROM streams s 
      LEFT JOIN playlists p ON s.playlist_id = p.id 
      WHERE s.id = ?
    `).get(streamId) as any;
    if (!stream) return;

    let inputArgs: string[] = [];
    let loopFlag: string[] = [];

    if (stream.source_type === 'video') {
      const video = db.prepare("SELECT filepath FROM media WHERE id = ?").get(stream.video_id) as any;
      if (!video) {
        this.log(stream.user_id, "error", `Stream ${stream.name} video source not found.`);
        return;
      }
      if (stream.loop) loopFlag = ["-stream_loop", "-1"];
      inputArgs = ["-i", video.filepath];
    } else {
      const playlistItems = db.prepare(`
        SELECT m.filepath 
        FROM playlist_items pi 
        JOIN media m ON pi.media_id = m.id 
        WHERE pi.playlist_id = ? 
        ORDER BY pi.order_index ASC
      `).all(stream.playlist_id) as any[];

      if (playlistItems.length === 0) {
        this.log(stream.user_id, "error", `Stream ${stream.name} has no items in playlist.`);
        return;
      }

      const playlistFile = path.join(__dirname, `playlist_${streamId}.txt`);
      const content = playlistItems.map(item => `file '${item.filepath}'`).join("\n");
      fs.writeFileSync(playlistFile, content);
      
      if (stream.playlist_loop || stream.loop) loopFlag = ["-stream_loop", "-1"];
      inputArgs = ["-f", "concat", "-safe", "0", "-i", playlistFile];
    }

    const rtmpDestination = `${stream.rtmp_url}/${stream.stream_key}`;
    const [width, height] = (stream.resolution || "1280x720").split("x");
    
    const args = [
      "-re",
      ...loopFlag,
      ...inputArgs,
      "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-tune", "zerolatency",
      "-b:v", `${stream.bitrate}k`,
      "-maxrate", `${stream.bitrate}k`,
      "-bufsize", `${stream.bitrate * 2}k`,
      "-pix_fmt", "yuv420p",
      "-g", "60",
      "-c:a", "aac",
      "-b:a", "128k",
      "-ar", "44100",
      "-f", "flv",
      rtmpDestination
    ];

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

    db.prepare("UPDATE streams SET status = 'live', started_at = CURRENT_TIMESTAMP WHERE id = ?").run(streamId);
    this.log(stream.user_id, "info", `Stream ${stream.name} started.`);

    ffmpegProcess.on("error", (err) => {
      this.log(stream.user_id, "error", `Stream ${stream.name} spawn error: ${err.message}`);
    });

    ffmpegProcess.on("close", (code) => {
      this.activeStreams.delete(streamId);
      const currentStream = db.prepare("SELECT status FROM streams WHERE id = ?").get(streamId) as any;
      
      if (currentStream && currentStream.status === 'live') {
        const lastError = errorOutput.split("\n").filter(l => l.toLowerCase().includes("error")).slice(-3).join(" | ");
        this.log(stream.user_id, "error", `Stream ${stream.name} stopped unexpectedly (code ${code}). ${lastError ? 'Last errors: ' + lastError : ''} Restarting in 10s...`);
        setTimeout(() => this.startStream(streamId), 10000);
      } else {
        db.prepare("UPDATE streams SET status = 'idle', started_at = NULL WHERE id = ?").run(streamId);
        this.log(stream.user_id, "info", `Stream ${stream.name} stopped.`);
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
  }

  stopStream(streamId: number) {
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

  stopAll() {
    for (const [id, process] of this.activeStreams.entries()) {
      try {
        process.kill("SIGKILL");
      } catch (e) {}
    }
    this.activeStreams.clear();
  }

  private log(userId: number | null, type: string, message: string) {
    db.prepare("INSERT INTO logs (user_id, type, message) VALUES (?, ?, ?)").run(userId, type, message);
  }

  isLive(streamId: number) {
    return this.activeStreams.has(streamId);
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

// --- API Routes ---

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
    res.json({ success: true, user: req.session.user });
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

app.get("/api/me", (req, res) => {
  if (req.session.user) {
    const user = db.prepare("SELECT id, username, role, status, storage_limit, profile_picture FROM users WHERE id = ?").get(req.session.user.id) as any;
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

app.post("/api/me/profile", requireAuth, uploadProfile.single("profile"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  
  const profilePath = `/profiles/${req.file.filename}`;
  db.prepare("UPDATE users SET profile_picture = ? WHERE id = ?").run(profilePath, req.session.user.id);
  res.json({ success: true, profile_picture: profilePath });
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
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    // Preserve original filename but ensure it's unique if needed
    // However, user specifically asked: "tidak perlu ditambahkan nama (nomor) file, cukup memakai nama file bawaan"
    // To avoid collisions if multiple users upload same name, we might still need something, 
    // but I will follow the request strictly.
    cb(null, file.originalname);
  }
});
const upload = multer({ storage });

import axios from "axios";

app.post("/api/media/download", requireAuth, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });

  try {
    let downloadUrl = url;
    
    // Simple transformations for common services
    if (url.includes("drive.google.com")) {
      const match = url.match(/\/d\/(.+?)\//) || url.match(/id=(.+?)(&|$)/);
      if (match) downloadUrl = `https://drive.google.com/uc?export=download&id=${match[1]}`;
    } else if (url.includes("dropbox.com")) {
      downloadUrl = url.replace("dl=0", "dl=1");
    }

    const response = await axios({
      method: "get",
      url: downloadUrl,
      responseType: "stream",
    });

    const filename = `download-${Date.now()}.mp4`;
    const filepath = path.join(UPLOADS_DIR, filename);
    const writer = fs.createWriteStream(filepath);

    response.data.pipe(writer);

    writer.on("finish", () => {
      const thumbnailName = `thumb-${Date.now()}.jpg`;
      ffmpeg(filepath)
        .screenshots({
          timestamps: ["2%"],
          filename: thumbnailName,
          folder: THUMBNAILS_DIR,
          size: "320x180",
        })
        .on("end", () => {
          ffmpeg.ffprobe(filepath, (err, metadata) => {
            const duration = metadata?.format?.duration || 0;
            db.prepare("INSERT INTO media (user_id, filename, filepath, duration, thumbnail_path) VALUES (?, ?, ?, ?, ?)")
              .run(req.session.user.id, filename, filepath, Math.round(duration), thumbnailName);
            logAction(req.session.user.id, req.session.user.username, "Media Downloaded", `Downloaded ${filename} from URL`);
            res.json({ success: true });
          });
        })
        .on("error", (err) => {
          res.status(500).json({ error: "Failed to process downloaded video" });
        });
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to download from URL" });
  }
});

app.post("/api/media/upload", requireAuth, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const userId = req.session.user.id;
  const user = db.prepare("SELECT storage_limit FROM users WHERE id = ?").get(userId) as any;
  
  const mediaFiles = db.prepare("SELECT filepath FROM media WHERE user_id = ?").all(userId) as any[];
  let totalUsage = 0;
  mediaFiles.forEach(m => {
    if (fs.existsSync(m.filepath)) totalUsage += fs.statSync(m.filepath).size;
  });

  const limitBytes = user.storage_limit * 1024 * 1024 * 1024;
  if (totalUsage + req.file.size > limitBytes) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "Storage limit exceeded" });
  }

  const filepath = req.file.path;
  const filename = req.file.filename;
  const thumbnailName = filename + ".jpg";

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
        db.prepare("INSERT INTO media (user_id, filename, filepath, duration, thumbnail_path) VALUES (?, ?, ?, ?, ?)")
          .run(userId, filename, filepath, Math.round(duration), thumbnailName);
        logAction(userId, req.session.user.username, "Media Uploaded", `Uploaded ${filename}`);
        res.json({ success: true });
      });
    })
    .on("error", (err) => {
      res.status(500).json({ error: "Failed to process video" });
    });
});

app.get("/api/media", requireAuth, (req, res) => {
  const media = db.prepare("SELECT * FROM media WHERE user_id = ? ORDER BY created_at DESC").all(req.session.user.id);
  res.json(media);
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

// Streams
app.get("/api/streams", requireAuth, (req, res) => {
  const streams = db.prepare(`
    SELECT s.*, p.name as playlist_name, m.filename as video_name
    FROM streams s 
    LEFT JOIN playlists p ON s.playlist_id = p.id 
    LEFT JOIN media m ON s.video_id = m.id
    WHERE s.user_id = ?
    ORDER BY s.created_at DESC
  `).all(req.session.user.id);
  res.json(streams);
});

app.post("/api/streams", requireAuth, (req, res) => {
  const { name, source_type, playlist_id, video_id, platform, rtmp_url, stream_key, bitrate, resolution, loop, duration, start_time, start_date, repeat_type, repeat_days, repeat_date, schedule_enabled } = req.body;
  const result = db.prepare(`
    INSERT INTO streams (user_id, name, source_type, playlist_id, video_id, platform, rtmp_url, stream_key, bitrate, resolution, loop, duration, start_time, start_date, repeat_type, repeat_days, repeat_date, schedule_enabled) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.session.user.id, name, source_type || 'playlist', playlist_id, video_id, platform || 'youtube', rtmp_url, stream_key, bitrate || 3000, resolution || '1280x720', loop ? 1 : 0, duration || -1, start_time, start_date, repeat_type || 'none', repeat_days, repeat_date, schedule_enabled ? 1 : 0);
  logAction(req.session.user.id, req.session.user.username, "Stream Created", `Created stream: ${name}`);
  res.json({ id: result.lastInsertRowid });
});

app.put("/api/streams/:id", requireAuth, (req, res) => {
  const { name, source_type, playlist_id, video_id, platform, rtmp_url, stream_key, bitrate, resolution, loop, duration, start_time, start_date, repeat_type, repeat_days, repeat_date, schedule_enabled } = req.body;
  db.prepare(`
    UPDATE streams 
    SET name = ?, source_type = ?, playlist_id = ?, video_id = ?, platform = ?, rtmp_url = ?, stream_key = ?, bitrate = ?, resolution = ?, loop = ?, duration = ?, start_time = ?, start_date = ?, repeat_type = ?, repeat_days = ?, repeat_date = ?, schedule_enabled = ?
    WHERE id = ? AND user_id = ?
  `).run(name, source_type, playlist_id, video_id, platform, rtmp_url, stream_key, bitrate, resolution, loop ? 1 : 0, duration || -1, start_time, start_date, repeat_type || 'none', repeat_days, repeat_date, schedule_enabled ? 1 : 0, req.params.id, req.session.user.id);
  res.json({ success: true });
});

app.post("/api/streams/:id/start", requireAuth, (req, res) => {
  const stream = db.prepare("SELECT name, start_time, start_date FROM streams WHERE id = ? AND user_id = ?").get(req.params.id, req.session.user.id) as any;
  if (!stream) return res.status(404).json({ error: "Stream not found" });
  
  // Update last_triggered to prevent scheduler from picking it up in the same minute
  const timezone = db.prepare("SELECT value FROM settings WHERE key = 'timezone'").get() as any;
  const tz = timezone ? timezone.value : "UTC";
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

  streamManager.startStream(Number(req.params.id));
  logAction(req.session.user.id, req.session.user.username, "Stream Started", `Started stream: ${stream.name}`);
  res.json({ success: true });
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
  const users = db.prepare("SELECT id, username, role, status, storage_limit, profile_picture, created_at FROM users").all();
  res.json(users);
});

app.post("/api/users", requireAuth, requireAdmin, (req, res) => {
  const { username, password, role, status, storage_limit } = req.body;
  const hashedPassword = bcrypt.hashSync(password, 10);
  try {
    const result = db.prepare("INSERT INTO users (username, password, role, status, storage_limit) VALUES (?, ?, ?, ?, ?)")
      .run(username, hashedPassword, role || 'member', status || 'active', storage_limit || 10);
    res.json({ id: result.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: "Username already exists" });
  }
});

app.put("/api/users/:id", requireAuth, requireAdmin, (req, res) => {
  const { username, role, status, storage_limit, password } = req.body;
  if (password) {
    const hashedPassword = bcrypt.hashSync(password, 10);
    db.prepare("UPDATE users SET username = ?, role = ?, status = ?, storage_limit = ?, password = ? WHERE id = ?")
      .run(username, role, status, storage_limit, hashedPassword, req.params.id);
  } else {
    db.prepare("UPDATE users SET username = ?, role = ?, status = ?, storage_limit = ? WHERE id = ?")
      .run(username, role, status, storage_limit, req.params.id);
  }
  res.json({ success: true });
});

app.delete("/api/users/:id", requireAuth, requireAdmin, (req, res) => {
  if (Number(req.params.id) === req.session.user.id) {
    return res.status(400).json({ error: "Cannot delete yourself" });
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

// System Stats
import os from "os";
import checkDiskSpace from "check-disk-space";

app.get("/api/system/time", requireAuth, (req, res) => {
  const timezone = db.prepare("SELECT value FROM settings WHERE key = 'timezone'").get() as any;
  const tz = timezone ? timezone.value : "UTC";
  
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
      timezone: "UTC",
      formatted: now.toISOString(),
      currentTime: now.toISOString()
    });
  }
});

app.post("/api/system/settings", requireAuth, requireAdmin, (req, res) => {
  const { timezone, theme_mode } = req.body;
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
      try {
        await execAsync("git remote set-url origin https://github.com/acnudesign/SaungStream.git");
      } catch (e) {
        await execAsync("git remote add origin https://github.com/acnudesign/SaungStream.git");
      }
      await execAsync("git fetch origin main");
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
      updateAvailable: currentHash !== latestHash && latestHash !== "unknown",
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
      
      // 1. Check if git is initialized and ensure remote is correct
      try {
        await execAsync("git rev-parse --is-inside-work-tree");
        try {
          await execAsync("git remote set-url origin https://github.com/acnudesign/SaungStream.git");
        } catch (e) {
          await execAsync("git remote add origin https://github.com/acnudesign/SaungStream.git");
        }
      } catch (e) {
        await execAsync("git init");
        try {
          await execAsync("git remote add origin https://github.com/acnudesign/SaungStream.git");
        } catch (re) {}
      }

      // 2. Fetch latest
      console.log("Fetching latest from GitHub...");
      await execAsync("git fetch origin main");

      // 3. Close database connections to release file locks
      console.log("Closing database connections before reset...");
      try {
        db.close();
      } catch (e) {
        console.error("Error closing main DB:", e);
      }

      // 4. Try to rename root files to avoid git unlink errors
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

      // 5. Force remove DB files from Git index if they are tracked
      try {
        await execAsync("git rm --cached saungstream.db sessions.db saungstream.db-shm saungstream.db-wal");
      } catch (e) {}

      // 6. Reset to force update
      console.log("Resetting local state to match GitHub...");
      await execAsync("git reset --hard origin/main");
      
      console.log("Update completed successfully. Restarting...");
      process.exit(0);

    } catch (err: any) {
      console.error("Background update failed:", err);
      process.exit(1); 
    }
  }, 2000);
});

app.get("/api/system/stats", requireAuth, requireAdmin, async (req, res) => {
  const cpus = os.cpus();
  const load = os.loadavg();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const disk = await checkDiskSpace(process.cwd());

  // Mock internet speed for now as real speed test is heavy
  const stats = {
    cpu: {
      model: cpus[0].model,
      usage: Math.round((load[0] / cpus.length) * 100),
      cores: cpus.length
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
      download: (Math.random() * 100).toFixed(2), // Mocked
      upload: (Math.random() * 50).toFixed(2)    // Mocked
    }
  };

  res.json(stats);
});

// Serve static files
app.use("/thumbnails", express.static(THUMBNAILS_DIR));
app.use("/uploads", express.static(UPLOADS_DIR));
app.use("/profiles", express.static(PROFILES_DIR));

// --- Background Scheduler Engine ---
setInterval(() => {
  const timezone = db.prepare("SELECT value FROM settings WHERE key = 'timezone'").get() as any;
  const tz = timezone ? timezone.value : "UTC";
  
  const now = new Date();
  
  // Watchdog log every 10 minutes to confirm scheduler is alive
  if (now.getMinutes() % 10 === 0 && now.getSeconds() < 10) {
    console.log(`Scheduler Watchdog: Running at ${now.toISOString()}`);
  }
  
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
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`SaungStream running on http://localhost:${PORT}`);
  });
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
