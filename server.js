import "dotenv/config";
import express from "express";
import cors from "cors";
import bcrypt from "bcrypt";
import multer from "multer";
import path from "path";
import fs from "fs";
import db from "./mysql.js";
import { fileURLToPath } from "url";
import { dirname } from "path";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/* ===== CONFIG ===== */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ===== QNAP STORAGE PATH (แก้ path ตามจริง) ===== */
// สำหรับ QNAP ควรใช้ shared folder เช่น /share/Web หรือ /share/CACHEDEV1_DATA/Web
const STORAGE_BASE =
  process.env.STORAGE_PATH || path.join(__dirname, "uploads");
const AVATAR_DIR = path.join(STORAGE_BASE, "avatars");
const VIDEO_DIR = path.join(STORAGE_BASE, "videos");
const PROJECT_IMG_DIR = path.join(STORAGE_BASE, "project_images");

// สร้างโฟลเดอร์ทั้งหมด
[AVATAR_DIR, VIDEO_DIR, PROJECT_IMG_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

/* ===== STATIC FILES ===== */
app.use("/uploads", express.static(STORAGE_BASE));

/* ===== MULTER CONFIGURATIONS ===== */
// Avatar Upload
const avatarStorage = multer.diskStorage({
  destination: AVATAR_DIR,
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `avatar_${Date.now()}${ext}`);
  },
});

const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only images allowed"));
    }
    cb(null, true);
  },
});

// Video Upload
const videoStorage = multer.diskStorage({
  destination: VIDEO_DIR,
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `video_${Date.now()}${ext}`);
  },
});

const uploadVideo = multer({
  storage: videoStorage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB for QNAP
  fileFilter: (_, file, cb) => {
    if (!file.mimetype.startsWith("video/")) {
      return cb(new Error("Only videos allowed"));
    }
    cb(null, true);
  },
});

// Project Image Upload
// Project Image Upload - ปรับปรุงให้ชื่อไฟล์ไม่ซ้ำกัน
const projectImageStorage = multer.diskStorage({
  destination: PROJECT_IMG_DIR,
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 15); // เพิ่มความยาว
    const ext = path.extname(file.originalname).toLowerCase();
    const projectId = req.body.projectId || "pic";

    // สร้างชื่อไฟล์ที่ไม่ซ้ำกัน
    const filename = `${projectId}_${timestamp}_${randomStr}${ext}`;

    console.log("📝 Generated filename:", filename);

    cb(null, filename);
  },
});

const uploadProjectImage = multer({
  storage: projectImageStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp",
    ];

    console.log("🔍 Checking file type:", file.mimetype);

    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Invalid file type: ${file.mimetype}. Allowed types: ${allowed.join(
            ", "
          )}`
        )
      );
    }
  },
});
/* ========================================
   USER AUTHENTICATION
   ======================================== */

// Register
app.post("/register", async (req, res) => {
  try {
    const { username, email, password, role, imageURL } = req.body;

    if (!username || !email || !password || !imageURL) {
      return res.status(400).json({ message: "Missing fields" });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password too short" });
    }

    const [exists] = await db.execute(
      "SELECT id FROM users WHERE email=? OR username=? LIMIT 1",
      [email.toLowerCase(), username]
    );

    if (exists.length > 0) {
      return res.status(409).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await db.execute(
      "INSERT INTO users (username, email, password, role, imageURL) VALUES (?,?,?,?,?)",
      [
        username,
        email.toLowerCase(),
        hashedPassword,
        role || "Artist",
        imageURL,
      ]
    );

    res.status(201).json({
      id: result.insertId,
      username,
      email,
      role,
      imageURL,
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Login
app.post("/login", async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ message: "Missing credentials" });
    }

    const [users] = await db.execute(
      "SELECT * FROM users WHERE email = ? OR username = ? LIMIT 1",
      [identifier.toLowerCase(), identifier]
    );

    const user = users[0];

    if (!user || !user.password) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    res.json({
      message: "Login successful",
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        imageURL: user.imageURL,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Login failed" });
  }
});

app.get("/getallusers", async (req, res) => {
  try {
    const [rows] = await db.execute("SELECT * FROM users");
    res.json(rows);
  } catch (err) {
    console.error("Get all users error:", err);
    res.status(500).json({ message: "Database error" });
  }
});

// Upload Avatar
app.post("/upload/avatar", uploadAvatar.single("avatar"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }
  res.json({ imageURL: `uploads/avatars/${req.file.filename}` });
});

/* ========================================
   VIDEO MANAGEMENT
   ======================================== */

// Upload Video
app.post("/upload/video", uploadVideo.single("video"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No video uploaded" });
    }

    const videoURL = `uploads/videos/${req.file.filename}`;

    const [result] = await db.execute(
      "INSERT INTO videos (video_url) VALUES (?)",
      [videoURL]
    );

    res.json({
      id: result.insertId,
      video_url: videoURL,
    });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ message: "Upload failed" });
  }
});

// Get Videos
app.get("/videos", async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT id, video_url FROM videos ORDER BY id DESC"
    );
    res.json(rows);
  } catch (err) {
    console.error("Get videos error:", err);
    res.status(500).json({ message: "Database error" });
  }
});

// Delete Video
app.delete("/videos/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.execute(
      "SELECT video_url FROM videos WHERE id = ?",
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Video not found" });
    }

    const videoPath = path.join(__dirname, rows[0].video_url);

    await db.execute("DELETE FROM videos WHERE id = ?", [id]);

    if (fs.existsSync(videoPath)) {
      fs.unlinkSync(videoPath);
    }

    res.json({ message: "Video deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Delete failed" });
  }
});

/* ========================================
   PROJECT MANAGEMENT
   ======================================== */

// Create Project
app.post("/newproject", async (req, res) => {
  try {
    const { projectName, description, createdBy, template } = req.body;

    if (!projectName) {
      return res.status(400).json({ message: "Project name required" });
    }

    const creatorInfo = createdBy || { uid: "admin", name: "admin" };

    const [projectResult] = await db.execute(
      "INSERT INTO projects (project_name, template, description, created_by, members, images, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())",
      [
        projectName,
        template || "",
        description || "",
        JSON.stringify(creatorInfo),
        JSON.stringify([]),
        JSON.stringify([]),
      ]
    );

    const projectId = projectResult.insertId;

    // Create default folders
    const defaultFolders = ["Assets", "Shots", "Tasks", "Media"];
    for (const folderName of defaultFolders) {
      await db.execute(
        "INSERT INTO project_folders (project_id, folder_name, description, created_at) VALUES (?, ?, ?, NOW())",
        [projectId, folderName, `${folderName} folder`]
      );
    }

    res.status(201).json({
      message: "Project created",
      projectId,
      project: { projectId, projectName },
    });
  } catch (err) {
    console.error("Create project error:", err);
    res.status(500).json({ message: "Failed to create project" });
  }
});

// Get Project List
app.post("/projectlist", async (req, res) => {
  try {
    const { uid } = req.body;

    if (!uid) {
      return res.status(400).json({ message: "User ID required" });
    }

    const [projects] = await db.execute(
  `
  SELECT p.*,
    (SELECT COUNT(*) FROM project_sequences WHERE project_id = p.id) as sequence_count,
    (SELECT COUNT(*) FROM project_shots WHERE project_id = p.id) as shot_count,
    (SELECT COUNT(*) FROM project_assets WHERE project_id = p.id) as asset_count
  FROM projects p
  WHERE JSON_CONTAINS(created_by, JSON_OBJECT('uid', ?))
     OR JSON_CONTAINS(members, CAST(? AS JSON))
  `,
  [
    uid,
    JSON.stringify(uid) // 🔥 สำคัญมาก
  ]
);


    const projectList = projects.map((p) => ({
      projectId: p.id,
      projectName: p.project_name,
      createdAt: p.created_at,
      createdBy: p.created_by || {},
      description: p.description,
      template: p.template,
      members: p.members || [],
      images: p.images || [],
      stats: {
        sequences: p.sequence_count || 0,
        shots: p.shot_count || 0,
        assets: p.asset_count || 0,
      },
    }));

    res.json({ projects: projectList });
  } catch (err) {
    console.error("Get projects error:", err);
    res.status(500).json({ message: "Failed to fetch projects" });
  }
});

function safeJSON(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

// Get Project Details
app.post("/projectdetails", async (req, res) => {
  try {
    const { projectId } = req.body;

    if (!projectId) {
      return res.status(400).json({ message: "Project ID required" });
    }

    const [projects] = await db.execute(
      "SELECT * FROM projects WHERE id = ? LIMIT 1",
      [projectId]
    );

    if (projects.length === 0) {
      return res.status(404).json({ message: "Project not found" });
    }

    const [sequences] = await db.execute(
      "SELECT * FROM project_sequences WHERE project_id = ? ORDER BY order_index",
      [projectId]
    );

    const [shots] = await db.execute(
      "SELECT * FROM project_shots WHERE project_id = ? ORDER BY id",
      [projectId]
    );

    const [assets] = await db.execute(
      "SELECT * FROM project_assets WHERE project_id = ? ORDER BY id",
      [projectId]
    );

    const [folders] = await db.execute(
      "SELECT * FROM project_folders WHERE project_id = ? ORDER BY id",
      [projectId]
    );

    const project = projects[0];

    res.json({
      project: {
        projectId: project.id,
        projectName: project.project_name,
        description: project.description,
        template: project.template,
        createdAt: project.created_at,

        createdBy: safeJSON(project.created_by, {}),
        members: safeJSON(project.members, []),
        images: safeJSON(project.images, []),
      },
      projectDetails: {
        sequences,
        shots,
        assets,
        folders,
      },
    });
  } catch (err) {
    console.error("Get project details error:", err);
    res.status(500).json({ message: "Failed to fetch project details" });
  }
});

app.post("/projectinfo", async (req, res) => {
  try {
    const { projectId } = req.body;

    if (!projectId) {
      return res.status(400).json({ message: "projectId is required" });
    }

    const [rows] = await db.execute(
      // ✅ เปลี่ยนจาก pool.query
      `SELECT * FROM projects WHERE id = ? LIMIT 1`,
      [projectId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Project not found" });
    }

    const project = rows[0];

    res.json({
      projectId: project.id,
      projectName: project.project_name,
      description: project.description,
      template: project.template,
      status: project.status,
      createdAt: project.created_at,
      createdBy: safeJSON(project.created_by, {}),
      members: safeJSON(project.members, []),
      images: safeJSON(project.images, []),
    });
  } catch (err) {
    console.error("❌ Get project info error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Delete Project
app.delete("/deleteProject", async (req, res) => {
  try {
    const { projectId } = req.body;

    if (!projectId) {
      return res.status(400).json({ message: "Project ID required" });
    }

    // Get files to delete
    const [files] = await db.execute(
      "SELECT download_url FROM files_project WHERE project_id = ? AND type = 'images'",
      [projectId]
    );

    // Delete files from disk
    for (const file of files) {
      try {
        const url = new URL(file.download_url);
        const filePath = path.join(__dirname, url.pathname);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        console.error("File delete error:", err.message);
      }
    }

    // Delete from database
    await db.execute("DELETE FROM files_project WHERE project_id = ?", [
      projectId,
    ]);
    const [result] = await db.execute("DELETE FROM projects WHERE id = ?", [
      projectId,
    ]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Project not found" });
    }

    res.json({
      message: "Project deleted",
      projectId,
      filesDeleted: files.length,
    });
  } catch (err) {
    console.error("Delete project error:", err);
    res.status(500).json({ message: "Delete failed" });
  }
});

// Upload Project Image
app.post("/upload", uploadProjectImage.single("file"), async (req, res) => {
  try {
    const { projectId, type = "images", oldImageUrl } = req.body;
    const file = req.file;

    if (!file || !projectId) {
      return res.status(400).json({ message: "Missing file or project ID" });
    }

    /* ===============================
         🗑️ ลบไฟล์เก่าใน filesystem
      =============================== */
    if (oldImageUrl) {
      try {
        console.log("🗑️ Deleting old image:", oldImageUrl);

        const url = new URL(oldImageUrl);
        const oldFilePath = path.join(__dirname, url.pathname);

        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
          console.log("✅ Old image file deleted");
        }
      } catch (err) {
        console.warn("⚠️ Failed to delete old image file:", err.message);
      }
    }

    /* ===============================
         📌 สร้าง URL รูปใหม่
      =============================== */
    const downloadURL = `http://${req.get("host")}/uploads/project_images/${
      file.filename
    }`;

    /* ===============================
         🔍 เช็คว่ามี record อยู่แล้วไหม
      =============================== */
    const [rows] = await db.execute(
      `SELECT id FROM files_project 
         WHERE project_id = ? AND type = ? 
         LIMIT 1`,
      [projectId, type]
    );

    let fileId;

    if (rows.length > 0) {
      /* ===============================
           🔁 UPDATE (มีอยู่แล้ว)
        =============================== */
      fileId = rows[0].id;

      await db.execute(
        `UPDATE files_project 
   SET download_url = ?
   WHERE id = ?`,
        [downloadURL, fileId]
      );

      console.log("🔁 Updated existing image record:", fileId);
    } else {
      /* ===============================
           ➕ INSERT (ยังไม่มี)
        =============================== */
      const [result] = await db.execute(
        `INSERT INTO files_project 
           (project_id, download_url, type, created_at)
           VALUES (?, ?, ?, NOW())`,
        [projectId, downloadURL, type]
      );

      fileId = result.insertId;
      console.log("➕ Inserted new image record:", fileId);
    }

    /* ===============================
         ✅ RESPONSE
      =============================== */
    res.json({
      message: "File uploaded",
      file: {
        id: fileId,
        projectId,
        fileUrl: downloadURL,
        filename: file.filename,
        fileType: type,
      },
    });
  } catch (err) {
    console.error("❌ Upload error:", err);

    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
      console.log("🗑️ Rolled back uploaded file");
    }

    res.status(500).json({
      message: "Upload failed",
      error: err.message,
    });
  }
});

// Delete Project Image (optional - ใช้สำหรับลบรูปแยกต่างหาก)
app.post("/delete-image", async (req, res) => {
  try {
    const { imageUrl, projectId } = req.body;

    if (!imageUrl || !projectId) {
      return res.status(400).json({ message: "Missing imageUrl or projectId" });
    }

    console.log("🗑️ Deleting image:", imageUrl);

    // แยก path จาก URL
    const url = new URL(imageUrl);
    const filePath = path.join(__dirname, url.pathname);

    console.log("📂 File path:", filePath);

    // ลบไฟล์จาก disk
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log("✅ Image file deleted from disk");
    } else {
      console.log("⚠️ Image file not found on disk");
    }

    // ลบข้อมูลในฐานข้อมูล
    const [result] = await db.execute(
      "DELETE FROM files_project WHERE project_id = ? AND download_url = ?",
      [projectId, imageUrl]
    );

    console.log("✅ Image record deleted from database");

    res.json({
      message: "Image deleted successfully",
      deleted: result.affectedRows > 0,
    });
  } catch (err) {
    console.error("❌ Delete image error:", err);
    res.status(500).json({
      message: "Failed to delete image",
      error: err.message,
    });
  }
});
// Clean up old project images (เก็บแค่รูปล่าสุด)
app.post("/cleanup-project-images", async (req, res) => {
  try {
    const { projectId } = req.body;

    if (!projectId) {
      return res.status(400).json({ message: "Project ID required" });
    }

    console.log("🧹 Cleaning up old images for project:", projectId);

    // ดึงรูปทั้งหมดของโปรเจค
    const [allImages] = await db.execute(
      "SELECT id, download_url, created_at FROM files_project WHERE project_id = ? AND type = 'images' ORDER BY created_at DESC",
      [projectId]
    );

    if (allImages.length <= 1) {
      return res.json({
        message: "No old images to clean up",
        kept: allImages.length,
      });
    }

    // เก็บรูปล่าสุด (ตัวแรก) ลบที่เหลือ
    const imagesToDelete = allImages.slice(1);
    let deletedCount = 0;

    for (const image of imagesToDelete) {
      try {
        // ลบไฟล์จาก disk
        const url = new URL(image.download_url);
        const filePath = path.join(__dirname, url.pathname);

        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log("🗑️ Deleted file:", filePath);
        }

        // ลบข้อมูลในฐานข้อมูล
        await db.execute("DELETE FROM files_project WHERE id = ?", [image.id]);

        deletedCount++;
      } catch (err) {
        console.error("⚠️ Error deleting image:", err.message);
      }
    }

    res.json({
      message: "Cleanup completed",
      kept: 1,
      deleted: deletedCount,
      total: allImages.length,
    });
  } catch (err) {
    console.error("❌ Cleanup error:", err);
    res.status(500).json({ message: "Cleanup failed" });
  }
});

// Get Project Images
app.get("/project/images", async (req, res) => {
  try {
    const { projectIds } = req.query;

    if (!projectIds) {
      return res.status(400).json({ message: "Project IDs required" });
    }

    const projectIdArray = projectIds.split(",").map((id) => id.trim());
    const placeholders = projectIdArray.map(() => "?").join(",");

    const [rows] = await db.execute(
      `SELECT fp.project_id, fp.download_url as url, fp.created_at
       FROM files_project fp
       INNER JOIN (
         SELECT project_id, MAX(created_at) as max_date
         FROM files_project
         WHERE type = 'images' AND project_id IN (${placeholders})
         GROUP BY project_id
       ) latest ON fp.project_id = latest.project_id AND fp.created_at = latest.max_date
       WHERE fp.type = 'images'`,
      projectIdArray
    );

    const imagesByProject = {};
    rows.forEach((row) => {
      if (!imagesByProject[row.project_id]) {
        imagesByProject[row.project_id] = [];
      }
      imagesByProject[row.project_id].push({
        url: row.url,
        created_at: row.created_at,
      });
    });

    res.json({ message: "Images fetched", images: imagesByProject });
  } catch (err) {
    console.error("Get images error:", err);
    res.status(500).json({ message: "Failed to fetch images" });
  }
});

/* ========================================
   SEQUENCES & SHOTS
   ======================================== */

// Create Sequence
app.post("/sequences", async (req, res) => {
  try {
    const { projectId, sequenceName, description, orderIndex } = req.body;

    if (!projectId || !sequenceName) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const [result] = await db.execute(
      "INSERT INTO project_sequences (project_id, sequence_name, description, order_index) VALUES (?, ?, ?, ?)",
      [projectId, sequenceName, description || "", orderIndex || 0]
    );

    res.json({ message: "Sequence created", sequenceId: result.insertId });
  } catch (err) {
    console.error("Create sequence error:", err);
    res.status(500).json({ message: "Failed to create sequence" });
  }
});

// Get Sequences
app.get("/sequences/:projectId", async (req, res) => {
  try {
    const [sequences] = await db.execute(
      "SELECT * FROM project_sequences WHERE project_id = ? ORDER BY order_index",
      [req.params.projectId]
    );
    res.json({ sequences });
  } catch (err) {
    console.error("Get sequences error:", err);
    res.status(500).json({ message: "Failed to fetch sequences" });
  }
});

// Delete Sequence
app.delete("/sequences/:sequenceId", async (req, res) => {
  try {
    await db.execute("DELETE FROM project_sequences WHERE id = ?", [
      req.params.sequenceId,
    ]);
    res.json({ message: "Sequence deleted" });
  } catch (err) {
    console.error("Delete sequence error:", err);
    res.status(500).json({ message: "Failed to delete sequence" });
  }
});

// Create Shot
app.post("/shots", async (req, res) => {
  try {
    const { projectId, sequenceId, shotName, status, description } = req.body;

    if (!projectId || !shotName) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const [result] = await db.execute(
      "INSERT INTO project_shots (project_id, sequence_id, shot_name, status, description) VALUES (?, ?, ?, ?, ?)",
      [
        projectId,
        sequenceId || null,
        shotName,
        status || "Not Started",
        description || "",
      ]
    );

    res.json({ message: "Shot created", shotId: result.insertId });
  } catch (err) {
    console.error("Create shot error:", err);
    res.status(500).json({ message: "Failed to create shot" });
  }
});

// Get Shots
app.get("/shots/:projectId", async (req, res) => {
  try {
    const [shots] = await db.execute(
      `SELECT s.*, seq.sequence_name 
       FROM project_shots s
       LEFT JOIN project_sequences seq ON s.sequence_id = seq.id
       WHERE s.project_id = ?
       ORDER BY s.id`,
      [req.params.projectId]
    );
    res.json({ shots });
  } catch (err) {
    console.error("Get shots error:", err);
    res.status(500).json({ message: "Failed to fetch shots" });
  }
});

// Update Shot
app.put("/shots/:shotId", async (req, res) => {
  try {
    const { status } = req.body;
    await db.execute("UPDATE project_shots SET status = ? WHERE id = ?", [
      status,
      req.params.shotId,
    ]);
    res.json({ message: "Shot updated" });
  } catch (err) {
    console.error("Update shot error:", err);
    res.status(500).json({ message: "Failed to update shot" });
  }
});

// Delete Shot
app.delete("/shots/:shotId", async (req, res) => {
  try {
    await db.execute("DELETE FROM project_shots WHERE id = ?", [
      req.params.shotId,
    ]);
    res.json({ message: "Shot deleted" });
  } catch (err) {
    console.error("Delete shot error:", err);
    res.status(500).json({ message: "Failed to delete shot" });
  }
});

app.get("/people", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        id,
        name,
        email,
        status,
        permission_group as permissionGroup,
        projects,
        groups_name as \`groups\`,
        created_at as createdAt
      FROM people
      ORDER BY created_at DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error("❌ DB error /people:", err);
    res.status(500).json({
      message: "Database error",
      error: err.message
    });
  }
});

/* ================= POST /people - สร้างคนใหม่ ================= */
app.post("/people", async (req, res) => {
  try {
    const {
      name,
      email,
      status = "Active",
      permissionGroup = "Artist",
      projects = "",
      groups = "",
      projectId
    } = req.body;

    // Validate required fields
    if (!name || !email) {
      return res.status(400).json({ 
        message: "Missing required fields: name and email are required" 
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        message: "Invalid email format" 
      });
    }

    // Check if email already exists
    const [existing] = await db.query(
      "SELECT id FROM people WHERE email = ?",
      [email]
    );

    if (existing.length > 0) {
      return res.status(409).json({ 
        message: "Email already exists" 
      });
    }

    // Insert new person
    const [result] = await db.execute(
      `INSERT INTO people 
        (name, email, status, permission_group, projects, groups_name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, email, status, permissionGroup, projects, groups]
    );

    const memberId = await db.query(
      `SELECT id 
       FROM users 
       WHERE email = ?`,
      [email]
    );
    
    
    // 1. ดึง members เดิม
const [rows] = await db.execute(
  `SELECT members FROM projects WHERE projectId = ?`,
  [projectId]
);

let members = [];

if (rows.length && rows[0].members) {
  members = JSON.parse(rows[0].members);
}

// 2. เช็คว่ามี member นี้แล้วหรือยัง
if (!members.includes(memberId)) {
  members.push(memberId);
}

// 3. update กลับเข้า DB
await db.execute(
  `UPDATE projects 
   SET members = ?
   WHERE projectId = ?`,
  [JSON.stringify(members), projectId]
);


    res.status(201).json(updated[0]);

    // Get the created person
    const [newPerson] = await db.query(
      `SELECT 
        id,
        name,
        email,
        status,
        permission_group as permissionGroup,
        projects,
        groups_name as \`groups\`,
        created_at as createdAt
      FROM people 
      WHERE id = ?`,
      [result.insertId]
    );

    
    console.log(`✅ Created person: ${name} (ID: ${result.insertId})`);
    res.status(201).json(newPerson[0]);
    

  } catch (err) {
    console.error("❌ Create person error:", err);
    res.status(500).json({ 
      message: "Failed to create person", 
      error: err.message 
    });
  }
});

/* ================= PUT /people/:id - อัปเดตข้อมูลคน ================= */
app.put("/people/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ID
    if (!id || isNaN(id)) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    // Check if person exists
    const [existing] = await db.query(
      "SELECT id FROM people WHERE id = ?",
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ message: "Person not found" });
    }

    // Field mapping: frontend field -> database column
    const fieldMapping = {
      name: "name",
      email: "email",
      status: "status",
      permissionGroup: "permission_group",
      projects: "projects",
      groups: "groups_name",
    };

    // Get the field to update
    const frontendField = Object.keys(req.body)[0];
    const value = req.body[frontendField];

    if (!frontendField || value === undefined) {
      return res.status(400).json({ message: "No field to update" });
    }

    const dbColumn = fieldMapping[frontendField];

    if (!dbColumn) {
      return res.status(400).json({ 
        message: `Invalid field: ${frontendField}` 
      });
    }

    // Special validation for specific fields
    if (frontendField === "email") {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        return res.status(400).json({ message: "Invalid email format" });
      }

      // Check if email already exists (for other users)
      const [emailExists] = await db.query(
        "SELECT id FROM people WHERE email = ? AND id != ?",
        [value, id]
      );

      if (emailExists.length > 0) {
        return res.status(409).json({ message: "Email already exists" });
      }
    }

    if (frontendField === "status" && !["Active", "Inactive"].includes(value)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    if (frontendField === "permissionGroup" && !["Admin", "Worker", "Manager", "Artist"].includes(value)) {
      return res.status(400).json({ message: "Invalid permission group" });
    }

    // Build safe query using parameterized statements
    const query = `UPDATE people SET ${dbColumn} = ? WHERE id = ?`;
    await db.execute(query, [value, id]);

    // Get updated person
    const [updated] = await db.query(
      `SELECT 
        id,
        name,
        email,
        status,
        permission_group as permissionGroup,
        projects,
        groups_name as \`groups\`,
        created_at as createdAt
      FROM people 
      WHERE id = ?`,
      [id]
    );

    console.log(`✅ Updated person ID ${id}: ${frontendField} = ${value}`);
    res.json(updated[0]);

  } catch (err) {
    console.error("❌ Update person error:", err);
    res.status(500).json({ 
      message: "Failed to update person", 
      error: err.message 
    });
  }
});

/* ================= DELETE /people/:id - ลบคน ================= */
app.delete("/people/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ID
    if (!id || isNaN(id)) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    // Check if person exists
    const [existing] = await db.query(
      "SELECT name FROM people WHERE id = ?",
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ message: "Person not found" });
    }

    await db.execute(
      "DELETE FROM people WHERE id = ?",
      [id]
    );

    console.log(`✅ Deleted person: ${existing[0].name} (ID: ${id})`);
    res.json({ 
      message: "Person deleted successfully",
      id: parseInt(id)
    });

  } catch (err) {
    console.error("❌ Delete person error:", err);
    res.status(500).json({ 
      message: "Failed to delete person", 
      error: err.message 
    });
  }
});

/* ================= GET /seats - ดึงข้อมูลที่นั่ง ================= */
app.get("/seats", async (req, res) => {
  try {
    const [result] = await db.query(`
      SELECT COUNT(*) as used,
             50 as total
      FROM people
      WHERE status = 'Active'
    `);

    res.json({
      total: result[0].total,
      used: result[0].used,
      available: result[0].total - result[0].used
    });
  } catch (err) {
    console.error("❌ Seats error:", err);
    res.status(500).json({ 
      message: "Failed to get seats info", 
      error: err.message 
    });
  }
});

/* ========================================
   HEALTH CHECK
   ======================================== */
app.get("/", (req, res) => {
  res.send("✅ API is running on QNAP");
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    storage: STORAGE_BASE,
  });
});

/* ========================================
   START SERVER
   ======================================== */
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 API running on port ${PORT}`);
  console.log(`📁 Storage path: ${STORAGE_BASE}`);
});

export default app;
