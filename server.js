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

/* ===== CONFIGURATION ===== */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ===== STORAGE PATHS ===== */
const STORAGE_BASE =
  process.env.STORAGE_PATH || path.join(__dirname, "uploads");

const STORAGE_DIRS = {
  avatars: path.join(STORAGE_BASE, "avatars"),
  videos: path.join(STORAGE_BASE, "videos"),

  project: {
    image: path.join(STORAGE_BASE, "project_file/image"),
    video: path.join(STORAGE_BASE, "project_file/video"),
    note: path.join(STORAGE_BASE, "project_file/note"),
    comment: path.join(STORAGE_BASE, "project_file/note/comment"),
    version: path.join(STORAGE_BASE, "project_file/version"),
  },

  shot: {
    image: path.join(STORAGE_BASE, "shot_file/image"),
    video: path.join(STORAGE_BASE, "shot_file/video"),
    note: path.join(STORAGE_BASE, "shot_file/note"),
    comment: path.join(STORAGE_BASE, "shot_file/note/comment"),
    version: path.join(STORAGE_BASE, "shot_file/version"),
  },

  sequence: {
    image: path.join(STORAGE_BASE, "sequence_file/image"),
    video: path.join(STORAGE_BASE, "sequence_file/video"),
    note: path.join(STORAGE_BASE, "sequence_file/note"),
    comment: path.join(STORAGE_BASE, "sequence_file/note/comment"),
    version: path.join(STORAGE_BASE, "sequence_file/version"),
  },

  asset: {
    image: path.join(STORAGE_BASE, "asset_file/image"),
    video: path.join(STORAGE_BASE, "asset_file/video"),
    note: path.join(STORAGE_BASE, "asset_file/note"),
    comment: path.join(STORAGE_BASE, "asset_file/note/comment"),
    version: path.join(STORAGE_BASE, "asset_file/version"),
  },
};

const typeMap = {
  image: "image",
  images: "image",
  video: "video",
  videos: "video",
  note: "note",
  version: "version",
  comment: "comment",
};

app.use("/uploads", (req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Range, Content-Type, Authorization");
  res.header("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length, Content-Type");

  if (req.method === "OPTIONS") return res.sendStatus(204);

  const isVideo = /\.(mp4|webm|ogg|mov|avi|mkv)$/i.test(req.path);
  if (!isVideo) return next();

  // Custom range request handler สำหรับวิดีโอ
  const filePath = path.join(STORAGE_BASE, req.path);
  if (!fs.existsSync(filePath)) return res.status(404).send("Not found");

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (!range) {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": "video/mp4",
      "Accept-Ranges": "bytes",
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  const parts = range.replace(/bytes=/, "").split("-");
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 2 * 1024 * 1024, fileSize - 1);
  const chunkSize = end - start + 1;

  res.writeHead(206, {
    "Content-Range": `bytes ${start}-${end}/${fileSize}`,
    "Accept-Ranges": "bytes",
    "Content-Length": chunkSize,
    "Content-Type": "video/mp4",
  });

  fs.createReadStream(filePath, { start, end }).pipe(res);

}, express.static(STORAGE_BASE, {
  setHeaders: (res, filePath) => {
    if (!/\.(mp4|webm|ogg|mov|avi|mkv)$/i.test(filePath)) return;
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  }
}));

/* ===== UTILITY FUNCTIONS ===== */
const safeJSON = (value, fallback) => {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

// ===== DYNAMIC DESTINATION HELPER (จาก DB) =====
const getProjectName = async (projectId) => {
  const [rows] = await db.execute(
    "SELECT project_name FROM projects WHERE id = ? LIMIT 1",
    [projectId]
  );
  const name = rows[0]?.project_name || "unknown";
  const safe = name
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_\-\u0E00-\u0E7F]/g, "");

  return safe || `project_${projectId}`;
};

const getDynamicDest = (entityFolder) => async (req, file, cb) => {
  try {
    const projectId = req.body.projectId || req.body.project_id;
    const sequenceId = req.body.sequenceId || req.body.sequence_id;
    const shotId = req.body.shotId || req.body.shot_id;
    const assetId = req.body.assetId || req.body.asset_id;

    let resolvedProjectId = projectId;

    // ถ้าไม่มี projectId → ดึงจาก entity อื่น
    if (!resolvedProjectId) {
      if (sequenceId) {
        const [rows] = await db.execute(
          "SELECT project_id FROM project_sequences WHERE id = ? LIMIT 1",
          [sequenceId]
        );
        resolvedProjectId = rows[0]?.project_id;
      } else if (shotId) {
        const [rows] = await db.execute(
          "SELECT project_id FROM project_shots WHERE id = ? LIMIT 1",
          [shotId]
        );
        resolvedProjectId = rows[0]?.project_id;
      } else if (assetId) {
        const [rows] = await db.execute(
          "SELECT project_id FROM project_assets WHERE id = ? LIMIT 1",
          [assetId]
        );
        resolvedProjectId = rows[0]?.project_id;
      }
    }

    let safeProjectName = "unknown";

    if (resolvedProjectId) {
      const [rows] = await db.execute(
        "SELECT project_name FROM projects WHERE id = ? LIMIT 1",
        [resolvedProjectId]
      );
      if (rows[0]?.project_name) {
        safeProjectName = rows[0].project_name
          .replace(/\s+/g, "_")
          .replace(/[^a-zA-Z0-9_\-\u0E00-\u0E7F]/g, ""); // ← เพิ่ม unicode ไทย

        if (!safeProjectName) safeProjectName = `project_${resolvedProjectId}`; // ← fallback
      }
    }

    const destPath = path.join(STORAGE_BASE, safeProjectName, entityFolder);
    if (!fs.existsSync(destPath)) {
      fs.mkdirSync(destPath, { recursive: true });
    }

    cb(null, destPath);
  } catch (err) {
    cb(err);
  }
};

const deleteFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch (err) {
    console.warn("File deletion failed:", err.message);
  }
  return false;
};

const buildFileURL = (req, folder, filename) =>
  `http://${req.get("host")}/uploads/${folder}/${filename}`;

/* ===== MULTER CONFIGURATIONS ===== */

const uploadAvatar = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (!fs.existsSync(STORAGE_DIRS.avatars)) {
        fs.mkdirSync(STORAGE_DIRS.avatars, { recursive: true });
      }
      cb(null, STORAGE_DIRS.avatars);
    },
    filename: (req, file, cb) => {
      const timestamp = Date.now();
      const ext = path.extname(file.originalname).toLowerCase();
      const nameWithoutExt = path.basename(file.originalname, ext);
      cb(null, `${nameWithoutExt}_${timestamp}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}`));
    }
  },
});

// ===== MULTER: PROJECT IMAGE =====
const uploadProjectImage = multer({
  storage: multer.diskStorage({
    destination: getDynamicDest("project_file/image"),
    filename: (req, file, cb) => {
      const safeName = file.originalname.replace(/\s+/g, "_");
      cb(null, safeName);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
    allowedTypes.includes(file.mimetype) ? cb(null, true) : cb(new Error(`Invalid file type: ${file.mimetype}`));
  },
});

// ===== MULTER: SEQUENCE =====
const uploadSequenceImage = multer({
  storage: multer.diskStorage({
    destination: getDynamicDest("sequence_file/image"),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const name = path.basename(file.originalname, ext);
      cb(null, `${name}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "image/jpeg", "image/jpg", "image/png", "image/gif", "image/avif", "image/jfif",
      "image/webp", "image/tiff", "video/mp4", "video/mov", "video/quicktime",
    ];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error(`Invalid file type: ${file.mimetype}`));
  },
});

// ===== MULTER: SHOT =====
const uploadShotImage = multer({
  storage: multer.diskStorage({
    destination: getDynamicDest("shot_file/image"),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const name = path.basename(file.originalname, ext);
      cb(null, `${name}${ext}`);
    },
  }),
  limits: { fileSize: 300 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "image/jpeg", "image/jpg", "image/png", "image/gif", "image/avif", "image/jfif",
      "image/webp", "image/tiff", "video/mp4", "video/mov", "video/quicktime",
    ];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error(`Invalid file type: ${file.mimetype}`));
  },
});

// ===== MULTER: ASSET =====
const uploadAssetImage = multer({
  storage: multer.diskStorage({
    destination: getDynamicDest("asset_file/image"),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const name = path.basename(file.originalname, ext);
      cb(null, `${name}${ext}`);
    },
  }),
  limits: { fileSize: 300 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "image/jpeg", "image/jpg", "image/png", "image/gif", "image/avif", "image/jfif",
      "image/webp", "image/tiff", "video/mp4", "video/mov", "video/quicktime",
    ];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error(`Invalid file type: ${file.mimetype}`));
  },
});

/* ===== Register User ===== */
app.post("/register", async (req, res) => {
  try {
    const { username, email, password, role, imageURL } = req.body;

    if (!username || !email || !password || !imageURL) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters" });
    }

    const [exists] = await db.execute(
      "SELECT id FROM users WHERE email=? OR username=? LIMIT 1",
      [email.toLowerCase(), username],
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
      ],
    );

    res.status(201).json({
      id: result.insertId,
      username,
      email,
      role: role || "Artist",
      imageURL,
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ===== Login User ===== */
app.post("/login", async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ message: "Missing credentials" });
    }

    const [users] = await db.execute(
      "SELECT * FROM users WHERE email = ? OR username = ? LIMIT 1",
      [identifier.toLowerCase(), identifier],
    );

    const user = users[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
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

/* ===== Select All User ===== */
app.get("/getallusers", async (req, res) => {
  try {
    const [rows] = await db.execute("SELECT * FROM users");
    res.json(rows);
  } catch (err) {
    console.error("Get users error:", err);
    res.status(500).json({ message: "Database error" });
  }
});


app.get("/getallviewers", async (req, res) => {
  try {
    const [rows] = await db.execute("SELECT * FROM users WHERE role = 'Viewer'");
    res.json(rows);
  } catch (err) {
    console.error("Get users error:", err);
    res.status(500).json({ message: "Database error" });
  }
});

/* ===== Upload User Avartar ===== */
app.post("/upload/avatar", uploadAvatar.single("avatar"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }
  res.json({ imageURL: `uploads/avatars/${req.file.filename}` });
});

/* ===== Create New Projects ===== */
app.post("/newproject", async (req, res) => {
  try {
    const { projectName, description, createdBy } = req.body;

    if (!projectName) {
      return res.status(400).json({ message: "Project name required" });
    }

    const creatorInfo = createdBy || { uid: "admin", name: "admin" };


    const [projectResult] = await db.execute(
      "INSERT INTO projects (project_name, description, created_by, images, created_at) VALUES (?, ?, ?, ?, NOW())",
      [
        projectName,
        description || "",
        JSON.stringify(creatorInfo),
        "[]",
      ],
    );

    const projectId = projectResult.insertId;

    // Create default folders
    const defaultFolders = ["Assets", "Shots", "Tasks", "Media"];
    for (const folderName of defaultFolders) {
      await db.execute(
        "INSERT INTO project_folders (project_id, folder_name, description, created_at) VALUES (?, ?, ?, NOW())",
        [projectId, folderName, `${folderName} folder`],
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

/* ===== Select All Projects From User ID AND members ===== */
app.post("/projectlist", async (req, res) => {
  try {
    const { created_by } = req.body;

    if (!created_by) {
      return res.status(400).json({ message: "created_by required" });
    }

    // ✅ ดึง email ของ user ปัจจุบันก่อน
    const [userResult] = await db.execute(
      `SELECT email FROM users WHERE id = ?`,
      [created_by]
    );

    const currentUserEmail = userResult[0]?.email;

    const [rows] = await db.execute(
      `
      SELECT 
        p.*,
        u.username AS created_by_username,

        CASE 
          WHEN p.created_by = ? THEN 'Owner'
          WHEN pv.user_id IS NOT NULL THEN 'Viewer'
          ELSE NULL
        END AS permission_group,

        (SELECT COUNT(*) FROM project_sequences WHERE project_id = p.id) AS sequence_count,
        (SELECT COUNT(*) FROM project_shots WHERE project_id = p.id) AS shot_count,
        (SELECT COUNT(*) FROM project_assets WHERE project_id = p.id) AS asset_count,
        
        -- ✅ เพิ่มส่วนนี้: ดึงรูปจาก files_project
        (SELECT download_url 
         FROM files_project 
         WHERE project_id = p.id 
         ORDER BY created_at DESC 
         LIMIT 1) AS thumbnail

      FROM projects p
      LEFT JOIN users u 
        ON p.created_by = u.id
      LEFT JOIN project_viewers pv
        ON p.id = pv.project_id AND pv.user_id = ?
        
      WHERE
        p.created_by = ?
        OR pv.user_id = ?
        
      ORDER BY p.created_at DESC
      `,
      [
        created_by,  // สำหรับ CASE WHEN (Owner check)
        created_by,  // สำหรับ LEFT JOIN project_viewers
        created_by,  // สำหรับ WHERE created_by (Owner)
        created_by   // สำหรับ WHERE pv.user_id (Viewer)
      ]
    );

    // จัดกลุ่มข้อมูล
    const projectMap = {};

    rows.forEach((row) => {
      if (!projectMap[row.id]) {
        projectMap[row.id] = {
          projectId: row.id,
          projectName: row.project_name,
          createdAt: row.created_at,
          createdBy: row.created_by,
          username: row.created_by_username,
          permissionGroup: row.permission_group,
          description: row.description,
          template: row.template,
          images: safeJSON(row.images, []),
          thumbnail: row.thumbnail || null, // ✅ เพิ่ม thumbnail
          stats: {
            sequences: Number(row.sequence_count) || 0,
            shots: Number(row.shot_count) || 0,
            assets: Number(row.asset_count) || 0,
          },
          people: [],
          peopleCount: 0,
        };
      }
    });

    const projectList = Object.values(projectMap);

    res.json({ projects: projectList });
  } catch (err) {
    console.error("Get projects error:", err);
    res.status(500).json({ message: "Failed to fetch projects" });
  }
});

/* ===== Select Projects Detail Where Project ID ===== */
app.post("/projectdetails", async (req, res) => {
  try {
    const { projectId } = req.body;

    if (!projectId) {
      return res.status(400).json({ message: "Project ID required" });
    }

    const [projects] = await db.execute(
      "SELECT * FROM projects WHERE id = ? LIMIT 1",
      [projectId],
    );

    if (projects.length === 0) {
      return res.status(404).json({ message: "Project not found" });
    }

    const [sequences, shots, assets, folders] = await Promise.all([
      db.execute(
        "SELECT * FROM project_sequences WHERE project_id = ? ORDER BY order_index",
        [projectId],
      ),
      db.execute(
        "SELECT * FROM project_shots WHERE project_id = ? ORDER BY id",
        [projectId],
      ),
      db.execute(
        "SELECT * FROM project_assets WHERE project_id = ? ORDER BY id",
        [projectId],
      ),
      db.execute(
        "SELECT * FROM project_folders WHERE project_id = ? ORDER BY id",
        [projectId],
      ),
    ]);

    const project = projects[0];

    res.json({
      project: {
        projectId: project.id,
        projectName: project.project_name,
        description: project.description,
        template: project.template,
        createdAt: project.created_at,
        createdBy: safeJSON(project.created_by, {}),
        images: safeJSON(project.images, []),
      },
      projectDetails: {
        sequences: sequences[0],
        shots: shots[0],
        assets: assets[0],
        folders: folders[0],
      },
    });
  } catch (err) {
    console.error("Get project details error:", err);
    res.status(500).json({ message: "Failed to fetch project details" });
  }
});

/* ===== Select Projects Data Where ID ===== */
app.post("/projectinfo", async (req, res) => {
  try {
    const { projectId } = req.body;

    if (!projectId) {
      return res.status(400).json({ message: "projectId is required" });
    }

    const [rows] = await db.execute(
      "SELECT * FROM projects WHERE id = ? LIMIT 1",
      [projectId],
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
      images: safeJSON(project.images, []),
    });
  } catch (err) {
    console.error("Get project info error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ===== Delect Projects Where ID ===== */
app.delete("/deleteProject", async (req, res) => {
  try {
    const { projectId } = req.body;

    if (!projectId) {
      return res.status(400).json({ message: "Project ID required" });
    }

    const [files] = await db.execute(
      "SELECT download_url FROM files_project WHERE project_id = ? AND type = 'image'",
      [projectId],
    );

    const fileUrl = files[0]?.download_url;
    let fileDeleted = false;

    // 2. ลบไฟล์ถ้ามี file_url
    if (fileUrl) {
      try {
        let pathname = fileUrl;

        // ถ้าเป็น URL เต็ม → ดึง pathname
        if (fileUrl.startsWith("http")) {
          pathname = new URL(fileUrl).pathname;
        }

        // ตัด /uploads ออกให้เหลือ path ภายใน storage
        const relativePath = pathname.replace(/^\/?uploads\//, "");
        const fullPath = path.join(STORAGE_BASE, relativePath);

        console.log("🗑️ Deleting file:", fullPath);

        fileDeleted = deleteFile(fullPath);

        if (fileDeleted) {
          console.log("✅ File deleted successfully");
        } else {
          console.warn("⚠️ File not found:", fullPath);
        }
      } catch (err) {
        console.warn("❌ Failed to delete file:", err.message);
      }
    }

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

/* ===== Delete Project Image In Storage path When Project Deleted ===== */
app.post("/delete-image", async (req, res) => {
  try {
    const { imageUrl, projectId } = req.body;

    if (!imageUrl || !projectId) {
      return res.status(400).json({ message: "Missing imageUrl or projectId" });
    }

    const url = new URL(imageUrl);
    deleteFile(path.join(__dirname, url.pathname));

    const [result] = await db.execute(
      "DELETE FROM files_project WHERE project_id = ? AND download_url = ?",
      [projectId, imageUrl],
    );

    res.json({
      message: "Image deleted successfully",
      deleted: result.affectedRows > 0,
    });
  } catch (err) {
    console.error("Delete image error:", err);
    res
      .status(500)
      .json({ message: "Failed to delete image", error: err.message });
  }
});

/* ===== Cleanup Image Project In DB ===== */
app.post("/cleanup-project-images", async (req, res) => {
  try {
    const { projectId } = req.body;

    if (!projectId) {
      return res.status(400).json({ message: "Project ID required" });
    }

    const [allImages] = await db.execute(
      "SELECT id, download_url FROM files_project WHERE project_id = ? AND type = 'images' ORDER BY created_at DESC",
      [projectId],
    );

    if (allImages.length <= 1) {
      return res.json({
        message: "No old images to clean up",
        kept: allImages.length,
      });
    }

    const imagesToDelete = allImages.slice(1);
    let deletedCount = 0;

    for (const image of imagesToDelete) {
      try {
        const url = new URL(image.download_url);
        deleteFile(path.join(__dirname, url.pathname));
        await db.execute("DELETE FROM files_project WHERE id = ?", [image.id]);
        deletedCount++;
      } catch (err) {
        console.error("Error deleting image:", err.message);
      }
    }

    res.json({
      message: "Cleanup completed",
      kept: 1,
      deleted: deletedCount,
      total: allImages.length,
    });
  } catch (err) {
    console.error("Cleanup error:", err);
    res.status(500).json({ message: "Cleanup failed" });
  }
});

/* ===== Select Project Image In DB Where ID ===== */
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
      projectIdArray,
    );

    const imagesByProject = rows.reduce((acc, row) => {
      if (!acc[row.project_id]) acc[row.project_id] = [];
      acc[row.project_id].push({ url: row.url, created_at: row.created_at });
      return acc;
    }, {});

    res.json({ message: "Images fetched", images: imagesByProject });
  } catch (err) {
    console.error("Get images error:", err);
    res.status(500).json({ message: "Failed to fetch images" });
  }
});

/* ===== Create New Sequence IN DB ===== */
app.post("/sequences", async (req, res) => {
  try {
    const { projectId, sequenceName, description, orderIndex } = req.body;

    if (!projectId || !sequenceName) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const [result] = await db.execute(
      "INSERT INTO project_sequences (project_id, sequence_name, description, order_index) VALUES (?, ?, ?, ?)",
      [projectId, sequenceName, description || "", orderIndex || 0],
    );

    res.json({ message: "Sequence created", sequenceId: result.insertId });
  } catch (err) {
    console.error("Create sequence error:", err);
    res.status(500).json({ message: "Failed to create sequence" });
  }
});

/* ===== Select Sequence From project_sequences Where Project ID ===== */
app.get("/sequences/:projectId", async (req, res) => {
  try {
    const [sequences] = await db.execute(
      "SELECT * FROM project_sequences WHERE project_id = ? ORDER BY order_index",
      [req.params.projectId],
    );
    res.json({ sequences });
  } catch (err) {
    console.error("Get sequences error:", err);
    res.status(500).json({ message: "Failed to fetch sequences" });
  }
});

/* ===== Delete Sequence Where ID ===== */
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

/* ===== Select Sequence Where Project ID ===== */
app.post("/getsequence", async (req, res) => {
  try {
    const { projectId } = req.body;

    if (!projectId) {
      return res.status(400).json({ message: "projectId is required" });
    }

    const [rows] = await db.execute(
      "SELECT * FROM project_sequences WHERE project_id = ? ORDER BY order_index",
      [projectId],
    );

    res.json(rows);
  } catch (err) {
    console.error("Get sequence error:", err);
    res.status(500).json({ message: "Database error", error: err.message });
  }
});

/* ===== Select Shot Where Project ID ===== */
app.post("/getshots", async (req, res) => {
  try {
    const { projectId, sequenceId } = req.body;

    if (!projectId || !sequenceId) {
      return res
        .status(400)
        .json({ message: "projectId and sequenceId are required" });
    }

    const [rows] = await db.execute(
      "SELECT * FROM project_shots WHERE project_id = ? AND sequence_id = ? ORDER BY order_index",
      [projectId, sequenceId],
    );

    res.json(rows);
  } catch (err) {
    console.error("Get shots error:", err);
    res.status(500).json({ message: "Database error", error: err.message });
  }
});

/* ===== Select Sequence ===== */
app.post("/project-sequences", async (req, res) => {
  try {
    const { projectId } = req.body;

    if (!projectId) {
      return res.status(400).json({ message: "projectId is required" });
    }

    const [rows] = await db.execute(
      `
      SELECT
        s.*,
        COUNT(sh.id) AS shot_count
      FROM project_sequences s
      LEFT JOIN project_shots sh
        ON sh.sequence_id = s.id
      WHERE s.project_id = ?
      GROUP BY s.id
      ORDER BY s.order_index ASC
      `,
      [projectId],
    );

    res.json(rows);
  } catch (err) {
    console.error("Get project sequences error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ===== Update Sequence  Name, Description, Status  ===== */
app.put("/project-sequences/update", async (req, res) => {
  try {
    const { id, sequence_name, description, status } = req.body;

    if (!id) {
      return res.status(400).json({ message: "sequence id is required" });
    }

    const updates = [];
    const values = [];

    if (sequence_name !== undefined) {
      updates.push("sequence_name = ?");
      values.push(sequence_name);
    }
    if (description !== undefined) {
      updates.push("description = ?");
      values.push(description);
    }
    if (status !== undefined) {
      updates.push("status = ?");
      values.push(status);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }

    values.push(id);
    await db.execute(
      `UPDATE project_sequences SET ${updates.join(", ")} WHERE id = ?`,
      values,
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Update sequence error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ===== Create Sequence In project_sequences ===== */
app.post("/project-sequences/create", async (req, res) => {
  try {
    const { projectId, sequence_name, description } = req.body;

    if (!sequence_name?.trim()) {
      return res.status(400).json({ message: "Sequence name is required" });
    }

    const [[{ maxOrder }]] = await db.execute(
      "SELECT COALESCE(MAX(order_index), 0) AS maxOrder FROM project_sequences WHERE project_id = ?",
      [projectId],
    );

    const nextOrder = maxOrder + 1;

    const [result] = await db.execute(
      "INSERT INTO project_sequences (project_id, sequence_name, description, order_index, status) VALUES (?, ?, ?, ?, 'wtg')",
      [projectId, sequence_name, description || null, nextOrder],
    );

    res.json({ id: result.insertId, order_index: nextOrder, status: "wtg" });
  } catch (err) {
    console.error("Create sequence error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ===== Upload Project Image ===== */
app.post("/upload", uploadProjectImage.single("file"), async (req, res) => {
  try {
    const { projectId, type } = req.body;

    if (!req.file || !projectId) {
      return res.status(400).json({ message: "Missing file or project ID" });
    }

    const normalizedType = typeMap[type] || "image";
    const safeProjectName = await getProjectName(projectId);

    // ย้ายไฟล์ไปยัง subfolder type ที่ถูกต้อง (image/video/note/version)
    const targetDir = path.join(STORAGE_BASE, safeProjectName, `project_file/${normalizedType}`);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    const newPath = path.join(targetDir, req.file.filename);
    if (req.file.path !== newPath) fs.renameSync(req.file.path, newPath);

    const downloadURL = `uploads/${safeProjectName}/project_file/${normalizedType}/${req.file.filename}`;

    const [result] = await db.execute(
      "INSERT INTO files_project (project_id, download_url, type, filename, created_at) VALUES (?, ?, ?, ?, NOW())",
      [projectId, downloadURL, normalizedType, req.file.filename],
    );

    res.json({
      message: "File uploaded",
      file: {
        id: result.insertId,
        projectId,
        fileUrl: downloadURL,
        filename: req.file.filename,
        fileType: normalizedType,
      },
    });
  } catch (err) {
    console.error("Upload error:", err);
    if (req.file) deleteFile(req.file.path);
    res.status(500).json({ message: "Upload failed", error: err.message });
  }
});

/* ===== Upload Sequence Image ===== */
app.post("/sequence/upload", uploadSequenceImage.array("file", 10), async (req, res) => {
  const conn = await db.getConnection();

  try {
    const { sequenceId, type } = req.body;
    const sequenceIdNum = Number(sequenceId);

    if (!req.files || req.files.length === 0 || !sequenceIdNum || isNaN(sequenceIdNum)) {
      if (req.files) req.files.forEach(f => deleteFile(f.path));
      return res.status(400).json({ message: "Invalid sequence_id or missing files" });
    }

    await conn.beginTransaction();

    const [rows] = await conn.execute(
      "SELECT id, project_id FROM project_sequences WHERE id = ?",
      [sequenceIdNum]
    );

    if (rows.length === 0) {
      await conn.rollback();
      req.files.forEach(f => deleteFile(f.path));
      return res.status(400).json({ message: "Sequence not found" });
    }

    // ❗ ถ้าต้องการ "แทนที่ไฟล์ทั้งหมด" (เหมือนของเดิม)
    const [oldFiles] = await conn.execute(
      "SELECT download_url FROM files_sequence WHERE sequence_id = ?",
      [sequenceIdNum]
    );


    const normalizedType = typeMap[type] || "image";
    const safeProjectName = await getProjectName(rows[0].project_id);

    const targetDir = path.join(STORAGE_BASE, safeProjectName, `sequence_file/${normalizedType}`);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    const uploadedFiles = [];

    for (const file of req.files) {
      const newPath = path.join(targetDir, file.filename);

      if (file.path !== newPath) fs.renameSync(file.path, newPath);

      const downloadURL = `uploads/${safeProjectName}/sequence_file/${normalizedType}/${file.filename}`;

      const [result] = await conn.execute(
        `INSERT INTO files_sequence (sequence_id, download_url, filename, type, created_at)
         VALUES (?, ?, ?, ?, NOW())`,
        [sequenceIdNum, downloadURL, file.filename, normalizedType]
      );

      uploadedFiles.push({
        id: result.insertId,
        sequenceId: sequenceIdNum,
        fileUrl: downloadURL,
        filename: file.filename,
        fileType: normalizedType,
      });
    }

    // 👉 อัปเดต thumbnail / file_url (เลือกใช้ไฟล์แรก)
    if (uploadedFiles.length > 0 && ["image", "images", "video"].includes(type)) {
      await conn.execute(
        "UPDATE project_sequences SET file_url = ? WHERE id = ?",
        [uploadedFiles[0].fileUrl, sequenceIdNum]
      );
    }

    await conn.commit();

    res.json({
      message: "Multiple files uploaded successfully",
      files: uploadedFiles,
    });

  } catch (err) {
    await conn.rollback();
    if (req.files) req.files.forEach(f => deleteFile(f.path));

    res.status(500).json({ message: "Upload failed", error: err.message });
  } finally {
    conn.release();
  }
});


/* ===== Upload Shot Image ===== */
app.post("/shot/upload", uploadShotImage.array("file", 10), async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { shotId, type } = req.body;
    const shotIdNum = Number(shotId);

    if (!req.files?.length || !shotIdNum || isNaN(shotIdNum)) {
      if (req.files) req.files.forEach(f => deleteFile(f.path));
      return res.status(400).json({ message: "Invalid shot_id or missing files" });
    }

    await conn.beginTransaction();

    const [rows] = await conn.execute(
      "SELECT id, project_id FROM project_shots WHERE id = ?",
      [shotIdNum]
    );
    if (rows.length === 0) {
      await conn.rollback();
      req.files.forEach(f => deleteFile(f.path));
      return res.status(400).json({ message: "Shot not found" });
    }

    const normalizedType = typeMap[type] || "image";
    const safeProjectName = await getProjectName(rows[0].project_id);

    const targetDir = path.join(STORAGE_BASE, safeProjectName, `shot_file/${normalizedType}`);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    // ── ลบไฟล์เก่าออก เมื่อเป็น image / video (update ไม่ใช่ครั้งแรก) ─────────
    if (["image", "images", "video"].includes(type)) {
      const [oldFiles] = await conn.execute(
        "SELECT id, download_url FROM files_shot WHERE shot_id = ? AND type = ?",
        [shotIdNum, normalizedType]
      );

      for (const old of oldFiles) {
        // ลบไฟล์จริงบน disk
        const oldFilePath = path.join(STORAGE_BASE, old.download_url);
        deleteFile(oldFilePath);
      }

      if (oldFiles.length > 0) {
        // ลบ records ใน files_shot
        await conn.execute(
          "DELETE FROM files_shot WHERE shot_id = ? AND type = ?",
          [shotIdNum, normalizedType]
        );
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const insertedFiles = [];

    for (const file of req.files) {
      const newPath = path.join(targetDir, file.filename);
      if (file.path !== newPath) fs.renameSync(file.path, newPath);

      const downloadURL = `uploads/${safeProjectName}/shot_file/${normalizedType}/${file.filename}`;

      if (["image", "images", "video", "version"].includes(type)) {
        await conn.execute(
          "UPDATE project_shots SET file_url = ? WHERE id = ?",
          [downloadURL, shotIdNum]
        );
      }

      const [result] = await conn.execute(
        `INSERT INTO files_shot (shot_id, download_url, file_name, type, created_at)
         VALUES (?, ?, ?, ?, NOW())`,
        [shotIdNum, downloadURL, file.filename, normalizedType]
      );

      insertedFiles.push({
        id: result.insertId,
        shotId: shotIdNum,
        fileUrl: downloadURL,
        filename: file.filename,
        fileType: normalizedType,
      });
    }

    await conn.commit();
    res.json({ message: "Shot files replaced successfully", files: insertedFiles });
  } catch (err) {
    await conn.rollback();
    if (req.files) req.files.forEach(f => deleteFile(f.path));
    res.status(500).json({ message: "Upload failed", error: err.message });
  } finally {
    conn.release();
  }
});

/* ===== Upload Asset Image ===== */
app.post("/asset/upload", uploadAssetImage.array("file", 10), async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { assetId, type } = req.body;
    const assetIdNum = Number(assetId);

    if (!req.files?.length || !assetIdNum || isNaN(assetIdNum)) {
      if (req.files) req.files.forEach(f => deleteFile(f.path));
      return res.status(400).json({ message: "Invalid asset_id or missing file" });
    }

    await conn.beginTransaction();

    const [rows] = await conn.execute(
      "SELECT id, project_id FROM project_assets WHERE id = ?",
      [assetIdNum]
    );
    if (rows.length === 0) {
      await conn.rollback();
      req.files.forEach(f => deleteFile(f.path));
      return res.status(400).json({ message: "Asset not found" });
    }

    const normalizedType = typeMap[type] || "image";
    const safeProjectName = await getProjectName(rows[0].project_id);

    const targetDir = path.join(STORAGE_BASE, safeProjectName, `asset_file/${normalizedType}`);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    // ── ลบไฟล์เก่าออก เมื่อเป็น image / video (update ไม่ใช่ครั้งแรก) ─────────
    if (["image", "images", "video"].includes(type)) {
      const [oldFiles] = await conn.execute(
        "SELECT id, download_url FROM files_asset WHERE asset_id = ? AND type = ?",
        [assetIdNum, normalizedType]
      );

      for (const old of oldFiles) {
        const oldFilePath = path.join(STORAGE_BASE, old.download_url);
        deleteFile(oldFilePath);
      }

      if (oldFiles.length > 0) {
        await conn.execute(
          "DELETE FROM files_asset WHERE asset_id = ? AND type = ?",
          [assetIdNum, normalizedType]
        );
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const uploadedFiles = [];

    for (const file of req.files) {
      const newPath = path.join(targetDir, file.filename);
      if (file.path !== newPath) fs.renameSync(file.path, newPath);

      const downloadURL = `uploads/${safeProjectName}/asset_file/${normalizedType}/${file.filename}`;

      if (uploadedFiles.length === 0 && ["image", "video", "version"].includes(type)) {
        await conn.execute(
          "UPDATE project_assets SET file_url = ? WHERE id = ?",
          [downloadURL, assetIdNum]
        );
      }

      const [result] = await conn.execute(
        `INSERT INTO files_asset (asset_id, file_name, download_url, type, created_at)
         VALUES (?, ?, ?, ?, NOW())`,
        [assetIdNum, file.filename, downloadURL, normalizedType]
      );

      uploadedFiles.push({
        id: result.insertId,
        assetId: assetIdNum,
        fileUrl: downloadURL,
        filename: file.filename,
        fileType: normalizedType,
      });
    }

    await conn.commit();
    res.json({
      message: `Uploaded ${uploadedFiles.length} file(s) successfully`,
      files: uploadedFiles,
      file: uploadedFiles[0],
    });
  } catch (err) {
    await conn.rollback();
    if (req.files) req.files.forEach(f => deleteFile(f.path));
    res.status(500).json({ message: "Upload failed", error: err.message });
  } finally {
    conn.release();
  }
});

const updateNoteAssignments = async (noteId, peopleNames) => {
  // 1. ลบ assignments เดิมทั้งหมดของ note นี้
  await db.query('DELETE FROM note_assignments WHERE note_id = ?', [noteId]);

  if (!peopleNames || peopleNames.length === 0) return;

  // 2. lookup id จากชื่อ
  const placeholders = peopleNames.map(() => '?').join(', ');
  const [people] = await db.query(
    `SELECT id FROM people WHERE name IN (${placeholders})`,
    peopleNames
  );

  if (people.length === 0) return;

  // 3. insert assignments ใหม่
  const values = people.map((p) => [noteId, p.id]);
  await db.query(
    'INSERT INTO note_assignments (note_id, people_id) VALUES ?',
    [values]
  );
};

const EDITABLE_FIELDS = new Set([
  'subject', 'body', 'file_url', 'author',
  'status', 'visibility', 'created_at', 'tasks', 'read_status',
]);

const VALIDATORS = {
  visibility: (v) => ['Client', 'Internal'].includes(v),
  read_status: (v) => ['read', 'unread'].includes(v),
  status: (v) => typeof v === 'string' && v.trim().length > 0,
  subject: (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 255,
  body: (v) => typeof v === 'string',
  file_url: (v) => v === null || (typeof v === 'string' && v.length <= 1024),
  author: (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 100,
  created_at: (v) => !isNaN(Date.parse(v)),
  tasks: (v) => v === null || typeof v === 'object',
};

app.put('/edit-note/:id', async (req, res) => {
  const noteId = parseInt(req.params.id, 10);
  if (isNaN(noteId)) {
    return res.status(400).json({ success: false, message: 'Invalid note ID' });
  }

  let updates = {};
  if ('field' in req.body && 'value' in req.body) {
    updates[req.body.field] = req.body.value;
  } else {
    updates = { ...req.body };
  }

  const keys = Object.keys(updates);
  if (keys.length === 0) {
    return res.status(400).json({ success: false, message: 'No fields to update' });
  }

  // ── แยก assigned_people ออกจาก updates ──
  const assignedPeople = updates.assigned_people ?? null;
  delete updates.assigned_people;

  const noteKeys = Object.keys(updates);

  try {
    const [rows] = await db.query('SELECT id FROM notes WHERE id = ?', [noteId]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Note not found' });
    }
  } catch (err) {
    console.error('[edit-note] DB check error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }

  if (noteKeys.length > 0) {
    const invalid = [];
    for (const key of noteKeys) {
      if (!EDITABLE_FIELDS.has(key)) {
        invalid.push({ field: key, reason: 'Field not allowed' });
        continue;
      }
      const validate = VALIDATORS[key];
      if (validate && !validate(updates[key])) {
        invalid.push({ field: key, reason: `Invalid value: ${JSON.stringify(updates[key])}` });
      }
    }
    if (invalid.length > 0) {
      return res.status(422).json({ success: false, message: 'Validation failed', errors: invalid });
    }

    const setClauses = [];
    const params = [];
    for (const key of noteKeys) {
      setClauses.push(`\`${key}\` = ?`);
      if (key === 'created_at' && updates[key]) {
        params.push(new Date(updates[key]).toISOString().slice(0, 19).replace('T', ' '));
      } else if (key === 'tasks' && updates[key] !== null) {
        params.push(JSON.stringify(updates[key]));
      } else {
        params.push(updates[key] ?? null);
      }
    }
    params.push(noteId);

    try {
      await db.query(`UPDATE notes SET ${setClauses.join(', ')} WHERE id = ?`, params);
    } catch (err) {
      console.error('[edit-note] DB update error:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }
  }

  if (assignedPeople !== null) {
    try {
      await updateNoteAssignments(noteId, assignedPeople);
    } catch (err) {
      console.error('[edit-note] assignments update error:', err);
      return res.status(500).json({ success: false, message: 'Failed to update assignments' });
    }
  }

  // ── คืนข้อมูลล่าสุด ──
  try {
    const [updated] = await db.query(`
            SELECT n.*,
                   GROUP_CONCAT(DISTINCT p.name) as assigned_people
            FROM notes n
            LEFT JOIN note_assignments na ON n.id = na.note_id
            LEFT JOIN people p ON na.people_id = p.id
            WHERE n.id = ?
            GROUP BY n.id
        `, [noteId]);

    const note = updated[0];
    note.assigned_people = note.assigned_people ? note.assigned_people.split(',') : [];
    note.tasks = (() => { try { return note.tasks ? JSON.parse(note.tasks) : []; } catch { return []; } })();

    return res.status(200).json({ success: true, message: 'Note updated successfully', data: note });
  } catch (err) {
    console.error('[edit-note] fetch updated error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.delete("/delete-task", async (req, res) => {
  try {
    const { taskId } = req.body;

    if (!taskId) {
      return res.status(400).json({ message: "taskId is required" });
    }

    // ลบ task assignments และ reviewers ก่อน
    await db.execute("DELETE FROM task_assignments WHERE task_id = ?", [taskId]);
    await db.execute("DELETE FROM task_reviewers WHERE task_id = ?", [taskId]);

    // ลบ versions ที่เกี่ยวข้อง
    await db.execute(
      "DELETE FROM versions WHERE entity_type = 'task' AND entity_id = ?",
      [taskId]
    );

    // ===== จัดการ Notes =====
    const taskIdNum = Number(taskId);

    const [affectedNotes] = await db.execute(
      `SELECT id, tasks FROM notes 
       WHERE tasks IS NOT NULL 
         AND JSON_CONTAINS(tasks, ?, '$')`,
      [String(taskIdNum)]
    );

    for (const note of affectedNotes) {
      // ✅ รองรับทั้ง MySQL auto-parse (Array) และ string
      let taskArray = [];
      if (Array.isArray(note.tasks)) {
        taskArray = note.tasks;
      } else if (typeof note.tasks === 'string') {
        try { taskArray = JSON.parse(note.tasks); } catch { taskArray = []; }
      }

      // ลบ taskId ออกจาก array
      const updatedArray = taskArray.filter(id => Number(id) !== taskIdNum);

      if (updatedArray.length === 0) {
        // ไม่มี task เหลือ → ลบ note
        await db.execute("DELETE FROM note_assignments WHERE note_id = ?", [note.id]);
        await db.execute("DELETE FROM notes WHERE id = ?", [note.id]);
      } else {
        // ยังมี task อื่น → อัพเดทแค่เอา taskId นี้ออก
        await db.execute(
          "UPDATE notes SET tasks = ? WHERE id = ?",
          [JSON.stringify(updatedArray), note.id]
        );
      }
    }
    // =======================

    // ลบ task
    const [result] = await db.execute("DELETE FROM tasks WHERE id = ?", [taskId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Task not found" });
    }

    res.json({ message: "Task deleted successfully" });
  } catch (err) {
    console.error("Delete task error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

app.post("/get-all-project-shots", async (req, res) => {
  try {
    const { projectId } = req.body;

    if (!projectId) {
      return res.status(400).json({ error: "projectId is required" });
    }

    const query = `
      SELECT 
        *
      FROM project_shots
      WHERE project_id = ?
      ORDER BY order_index ASC, created_at DESC
    `;

    const [rows] = await db.query(query, [projectId]);

    res.json(rows);

  } catch (error) {
    console.error("❌ Error fetching project shots:", error);
    res.status(500).json({ error: "Failed to fetch project shots" });
  }
});

// /task-versions
app.post("/task-versions", async (req, res) => {
  const { entityId } = req.body;
  if (!entityId) {
    return res.status(400).json({ message: "entityId (task_id) เป็น required" });
  }

  try {
    const query = `
      SELECT 
        v.id,
        v.entity_type,
        v.entity_id,
        v.task_id,
        v.version_number,
        v.version_name,
        v.file_url,
        v.status,
        v.uploaded_by,
        v.created_at,
        v.file_size,
        v.description,
        p.name as uploaded_by_name
      FROM versions v
      LEFT JOIN people p ON v.uploaded_by = p.id
      WHERE v.task_id = ?
      ORDER BY v.created_at DESC, v.version_number DESC
    `;

    const [versions] = await db.query(query, [entityId]);
    res.json(versions);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch versions", error: err.message });
  }
});

// /add-version
app.post("/add-version-task", async (req, res) => {
  const { task_id, version_name, description, file_url, status, uploaded_by, file_size } = req.body;

  if (!task_id) {
    return res.status(400).json({ message: "task_id เป็น required" });
  }

  try {
    const [[task]] = await db.query(
      `SELECT entity_type, entity_id FROM tasks WHERE id = ?`,
      [task_id]
    );

    if (!task) return res.status(404).json({ message: "Task not found" });

    const entityType = task.entity_type || null;
    const entityId = task.entity_id || null;

    // ✅ แก้ตรงนี้ — นับ version_number จาก entity_type + entity_id
    // เพราะ unique constraint อยู่ที่ (entity_type, entity_id, version_number)
    let newVersionNumber = 1;

    if (entityType && entityId) {
      const [[{ maxVer }]] = await db.query(
        `SELECT COALESCE(MAX(version_number), 0) AS maxVer 
         FROM versions 
         WHERE entity_type = ? AND entity_id = ?`,
        [entityType, entityId]
      );
      newVersionNumber = maxVer + 1;
    } else {
      // กรณีไม่มี entity ให้นับจาก task_id แทน
      const [[{ maxVer }]] = await db.query(
        `SELECT COALESCE(MAX(version_number), 0) AS maxVer 
         FROM versions 
         WHERE task_id = ?`,
        [task_id]
      );
      newVersionNumber = maxVer + 1;
    }

    // แก้เป็น — เพิ่ม duplicate name check ก่อน INSERT
    let finalVersionName = version_name || null;

    if (finalVersionName && entityType && entityId) {
      const baseName = finalVersionName.replace(/\s\(\d+\)$/, '').trim();
      const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const [sameNameRows] = await db.query(
        `SELECT version_name FROM versions
         WHERE entity_type = ? AND entity_id = ?
         AND (version_name = ? OR version_name REGEXP ?)`,
        [entityType, entityId, baseName, `^${escapedBase} \\(\\d+\\)$`]
      );

      if (sameNameRows.length > 0) {
        finalVersionName = `${baseName} (${sameNameRows.length + 1})`;
      }
    }

    const [result] = await db.query(
      `INSERT INTO versions 
      (entity_type, entity_id, task_id, version_number, version_name, file_url, status, uploaded_by, file_size, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        entityType,
        entityId,
        task_id,
        newVersionNumber,
        finalVersionName,
        file_url || null,
        status || 'wtg',
        uploaded_by || null,
        file_size || null,
        description || null,
      ]
    );

    res.status(201).json({
      id: result.insertId,
      version_number: newVersionNumber,
      entity_type: entityType,
      entity_id: entityId
    });
  } catch (err) {
    console.error("❌ add-version error:", err);
    res.status(500).json({ message: "Failed to add version", error: err.message });
  }
});

app.post("/update-version", async (req, res) => {
  const { versionId, field, value } = req.body;

  const allowedFields = ['version_name', 'description', 'status', 'uploaded_by'];
  if (!allowedFields.includes(field)) {
    return res.status(400).json({ message: "Invalid field" });
  }

  try {
    await db.query(
      `UPDATE versions SET ${field} = ? WHERE id = ?`,
      [value ?? null, versionId]  // ✅ value ?? null รองรับกรณีส่ง null มา
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Update version error:", err);
    res.status(500).json({ message: "Failed to update version" });
  }
});

app.delete("/delete-version", async (req, res) => {
  const { versionId } = req.body;

  if (!versionId) {
    return res.status(400).json({ message: "versionId เป็น required" });
  }

  try {
    // ตรวจสอบก่อนว่า version นี้มีอยู่จริง
    const [[version]] = await db.query(
      `SELECT id, version_name, version_number FROM versions WHERE id = ?`,
      [versionId]
    );

    if (!version) {
      return res.status(404).json({ message: "ไม่พบ version นี้" });
    }

    // ลบ version
    await db.query(
      `DELETE FROM versions WHERE id = ?`,
      [versionId]
    );

    console.log(`✅ Version deleted: id=${versionId}, name=${version.version_name || `Version ${version.version_number}`}`);

    res.json({
      success: true,
      message: "Version deleted successfully",
      deletedId: versionId
    });

  } catch (err) {
    console.error("❌ Delete version error:", err);
    res.status(500).json({
      message: "Failed to delete version",
      error: err.message
    });
  }
});

app.delete("/delete-asset-version/:versionId", async (req, res) => {
  const { versionId } = req.params;
  const { entityId } = req.body;

  if (!versionId || !entityId) {
    return res.status(400).json({ message: "versionId และ entityId จำเป็นต้องส่งมา" });
  }

  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {

    // 🔎 เช็ค version
    const [[version]] = await conn.query(
      `SELECT id 
             FROM versions 
             WHERE id = ?`,
      [versionId]
    );

    if (!version) {
      await conn.rollback();
      return res.status(404).json({ message: "ไม่พบ version นี้" });
    }

    // 🔥 ลบ version (ไฟล์จะโดนลบเองจาก CASCADE)
    await conn.query(
      `DELETE FROM versions WHERE id = ?`,
      [versionId]
    );

    // 🔎 หา version ล่าสุดที่เหลือ
    const [[latest]] = await conn.query(
      `SELECT file_url
             FROM versions
             WHERE entity_id = ?
             AND entity_type = 'asset'
             ORDER BY version_number DESC
             LIMIT 1`,
      [entityId]
    );

    let newFileUrl;

    if (latest) {
      newFileUrl = latest.file_url;
    } else {
    const [[asset]] = await conn.query(
      `SELECT download_url 
        FROM files_asset 
        WHERE asset_id = ? 
        AND type IN ('image', 'video')
        ORDER BY created_at DESC 
        LIMIT 1`,
      [entityId]
    );

      newFileUrl = asset?.download_url || null;
    }

    await conn.query(
      `UPDATE project_assets
             SET file_url = ?
             WHERE id = ?`,
      [newFileUrl, entityId]
    );

    await conn.commit();

    res.json({
      success: true,
      deletedId: Number(versionId),
      newThumbnail: newFileUrl
    });

  } catch (err) {
    await conn.rollback();
    console.error("❌ Delete version error:", err);
    res.status(500).json({
      message: "Failed to delete version",
      error: err.message
    });
  } finally {
    conn.release();
  }
});

app.delete("/delete-shot-version/:versionId", async (req, res) => {
  const { versionId } = req.params;
  const { entityId } = req.body;

  if (!versionId || !entityId) {
    return res.status(400).json({ message: "versionId และ entityId จำเป็นต้องส่งมา" });
  }

  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {

    // 🔎 เช็ค version
    const [[version]] = await conn.query(
      `SELECT id 
             FROM versions 
             WHERE id = ?`,
      [versionId]
    );

    if (!version) {
      await conn.rollback();
      return res.status(404).json({ message: "ไม่พบ version นี้" });
    }

    // 🔥 ลบ version (ไฟล์จะโดนลบเองจาก CASCADE)
    await conn.query(
      `DELETE FROM versions WHERE id = ?`,
      [versionId]
    );

    // 🔎 หา version ล่าสุดที่เหลือ
    const [[latest]] = await conn.query(
      `SELECT file_url
             FROM versions
             WHERE entity_id = ?
             AND entity_type = 'shot'
             ORDER BY version_number DESC
             LIMIT 1`,
      [entityId]
    );

    let newFileUrl;

    if (latest) {
      newFileUrl = latest.file_url;
    } else {
const [[shot]] = await conn.query(
  `SELECT download_url 
    FROM files_shot 
    WHERE shot_id = ? 
    AND type IN ('image', 'video')
    ORDER BY created_at DESC 
    LIMIT 1`,
  [entityId]
);

      newFileUrl = shot?.download_url || null;
    }

    await conn.query(
      `UPDATE project_shots
             SET file_url = ?
             WHERE id = ?`,
      [newFileUrl, entityId]
    );

    await conn.commit();

    res.json({
      success: true,
      deletedId: Number(versionId),
      newThumbnail: newFileUrl
    });

  } catch (err) {
    await conn.rollback();
    console.error("❌ Delete version error:", err);
    res.status(500).json({
      message: "Failed to delete version",
      error: err.message
    });
  } finally {
    conn.release();
  }
});

// API ดึง Assets ทั้งหมดในโปรเจค
app.post("/get-project-assets", async (req, res) => {
  try {
    const { projectId } = req.body;

    if (!projectId) {
      return res.status(400).json({
        success: false,
        message: "projectId is required",
      });
    }

    const [rows] = await db.execute(
      `
      SELECT 
        id,
        asset_name,
        status,
        description,
        created_at
      FROM project_assets
      WHERE project_id = ?
      ORDER BY created_at DESC
      `,
      [projectId],
    );

    return res.json({
      success: true,
      count: rows.length,
      data: rows,
    });
  } catch (error) {
    console.error("get-project-assets error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

app.post("/get-asset-sequence", async (req, res) => {
  try {
    const { sequenceId } = req.body;

    if (!sequenceId) {
      return res.status(400).json({
        success: false,
        message: "sequenceId is required",
      });
    }

    const [rows] = await db.execute(
      `
      SELECT 
        asq.id as asset_sequence_id,
        asq.sequence_id,
        asq.asset_id,
        asq.created_at as linked_at,
        pa.asset_name,
        pa.status,
        pa.description,
        pa.created_at as asset_created_at
      FROM asset_sequences asq
      INNER JOIN project_assets pa ON asq.asset_id = pa.id
      WHERE asq.sequence_id = ?
      ORDER BY asq.created_at DESC
      `,
      [sequenceId],
    );

    return res.json({
      success: true,
      sequenceId,
      count: rows.length,
      data: rows,
    });
  } catch (error) {
    console.error("get-asset-sequence error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

app.post("/get-asset-shot", async (req, res) => {
  try {
    const { shotId } = req.body;

    if (!shotId) {
      return res.status(400).json({
        success: false,
        message: "shot is required",
      });
    }

    const [rows] = await db.execute(
      `
      SELECT 
        ast.id as asset_shot_id,
        ast.shot_id,
        ast.asset_id,
        ast.created_at as linked_at,
        pa.asset_name,
        pa.status,
        pa.description,
        pa.type as asset_type,
        pa.created_at as asset_created_at,
        pa.file_url as thumbnail
      FROM asset_shots ast
      INNER JOIN project_assets pa ON ast.asset_id = pa.id
      WHERE ast.shot_id = ?
      ORDER BY ast.created_at DESC
      `,
      [shotId],
    );

    return res.json({
      success: true,
      shotId,
      count: rows.length,
      data: rows,
    });
  } catch (error) {
    console.error("get-asset-sequence error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// เพิ่ม API สำหรับเพิ่ม Asset เข้า Sequence
app.post("/add-asset-to-sequence", async (req, res) => {
  try {
    const { sequenceId, assetId } = req.body;

    if (!sequenceId || !assetId) {
      return res.status(400).json({
        success: false,
        message: "sequenceId and assetId are required",
      });
    }

    // ตรวจสอบว่ามีอยู่แล้วหรือไม่
    const [existing] = await db.execute(
      "SELECT id FROM asset_sequences WHERE sequence_id = ? AND asset_id = ?",
      [sequenceId, assetId],
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Asset already linked to this sequence",
      });
    }

    const [result] = await db.execute(
      "INSERT INTO asset_sequences (sequence_id, asset_id) VALUES (?, ?)",
      [sequenceId, assetId],
    );

    return res.json({
      success: true,
      id: result.insertId,
      message: "Asset added to sequence successfully",
    });
  } catch (error) {
    console.error("add-asset-to-sequence error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

app.post("/add-asset-to-shot", async (req, res) => {
  try {
    const { shotId, assetId } = req.body;

    if (!shotId || !assetId) {
      return res.status(400).json({
        success: false,
        message: "shotId and assetId are required",
      });
    }

    // ตรวจสอบว่ามีอยู่แล้วหรือไม่
    const [existing] = await db.execute(
      "SELECT id FROM asset_shots WHERE shot_id = ? AND asset_id = ?",
      [shotId, assetId],
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Asset already linked to this shot",
      });
    }

    const [result] = await db.execute(
      "INSERT INTO asset_shots (shot_id, asset_id) VALUES (?, ?)",
      [shotId, assetId],
    );

    return res.json({
      success: true,
      id: result.insertId,
      message: "Asset added to shot successfully",
    });
  } catch (error) {
    console.error("add-asset-to-shot error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// เพิ่ม API สำหรับลบ Asset ออกจาก Sequence
app.delete("/remove-asset-from-sequence", async (req, res) => {
  try {
    const { assetSequenceId } = req.body;

    if (!assetSequenceId) {
      return res.status(400).json({
        success: false,
        message: "assetSequenceId is required",
      });
    }

    await db.execute("DELETE FROM asset_sequences WHERE id = ?", [
      assetSequenceId,
    ]);

    return res.json({
      success: true,
      message: "Asset removed from sequence successfully",
    });
  } catch (error) {
    console.error("remove-asset-from-sequence error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

app.delete("/remove-asset-from-shot", async (req, res) => {
  try {
    const { assetShotId } = req.body;

    if (!assetShotId) {
      return res.status(400).json({
        success: false,
        message: "assetSequenceId is required",
      });
    }

    await db.execute("DELETE FROM asset_shots WHERE id = ?", [assetShotId]);

    return res.json({
      success: true,
      message: "Asset removed from ShotId successfully",
    });
  } catch (error) {
    console.error("remove-asset-from-shot error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

app.post("/get-asset-version", async (req, res) => {
  try {
    const { entityId } = req.body;

    if (!entityId) {
      return res.status(400).json({ error: "entityId is required" });
    }

    const [versionRows] = await db.query(
      `SELECT 
                v.id,
                v.entity_type,
                v.entity_id,
                v.version_number,
                v.version_name,
                v.file_url,
                v.status,
                v.uploaded_by,
                p.name AS uploaded_by_name,
                v.created_at,
                v.description
             FROM versions v
             LEFT JOIN people p ON v.uploaded_by = p.id
             WHERE v.entity_type = 'asset' AND v.entity_id = ?
             ORDER BY v.version_number DESC`,
      [entityId]
    );

    res.json(versionRows);

  } catch (error) {
    console.error("❌ Error fetching asset versions:", error);
    res.status(500).json({ error: "Failed to fetch asset versions" });
  }
});

app.post("/get-shot-version", async (req, res) => {
  try {
    const { entityId } = req.body;

    if (!entityId) {
      return res.status(400).json({ error: "entityId is required" });
    }

    const [versionRows] = await db.query(
      `SELECT 
                v.id,
                v.entity_type,
                v.entity_id,
                v.version_number,
                v.version_name,
                v.file_url,
                v.status,
                v.uploaded_by,
                p.name AS uploaded_by_name,
                v.created_at,
                v.description
             FROM versions v
             LEFT JOIN people p ON v.uploaded_by = p.id
             WHERE v.entity_type = 'shot' AND v.entity_id = ?
             ORDER BY v.version_number DESC`,
      [entityId]
    );

    res.json(versionRows);

  } catch (error) {
    console.error("❌ Error fetching shot versions:", error);
    res.status(500).json({ error: "Failed to fetch shot versions" });
  }
});

app.post("/project-versions-grouped", async (req, res) => {
  try {
    const { projectId } = req.body;
    if (!projectId) {
      return res.status(400).json({ message: "projectId is required" });
    }

    const [rows] = await db.execute(
      `
      SELECT
        v.*,
        p.name AS uploaded_by_name,
        t.task_name,
        CASE
          WHEN v.entity_type = 'asset'    THEN a.asset_name
          WHEN v.entity_type = 'shot'     THEN s.shot_name
          WHEN v.entity_type = 'sequence' THEN seq.sequence_name
          ELSE 'Unassigned'
        END AS entity_name
      FROM versions v
      LEFT JOIN tasks t          ON t.id  = v.task_id
      LEFT JOIN people p         ON p.id  = v.uploaded_by
      LEFT JOIN project_assets a ON a.id  = v.entity_id AND v.entity_type = 'asset'
      LEFT JOIN project_shots  s ON s.id  = v.entity_id AND v.entity_type = 'shot'
      LEFT JOIN project_sequences seq
                                 ON seq.id = v.entity_id AND v.entity_type = 'sequence'
      WHERE 
        t.project_id = ?
        
        OR
        
        (v.task_id IS NULL AND (
          (v.entity_type = 'shot'     AND EXISTS (SELECT 1 FROM project_shots     WHERE id = v.entity_id AND project_id = ?))
          OR
          (v.entity_type = 'asset'    AND EXISTS (SELECT 1 FROM project_assets    WHERE id = v.entity_id AND project_id = ?))
          OR
          (v.entity_type = 'sequence' AND EXISTS (SELECT 1 FROM project_sequences WHERE id = v.entity_id AND project_id = ?))
        ))
      ORDER BY
        CASE
          WHEN v.entity_type = 'shot'     THEN 1
          WHEN v.entity_type = 'asset'    THEN 2
          WHEN v.entity_type = 'sequence' THEN 3
          ELSE 4
        END,
        entity_name ASC,
        v.version_number ASC
      `,
      [projectId, projectId, projectId, projectId]  // ✅ 4 ค่า
    );

    // จัดกลุ่มตาม entity (เหมือนเดิม)
    const grouped = rows.reduce((acc, version) => {
      const key =
        version.entity_type && version.entity_id
          ? `${version.entity_type}_${version.entity_id}`
          : "unassigned_0";

      if (!acc[key]) {
        acc[key] = {
          entity_id: version.entity_id || 0,
          entity_type: version.entity_type || "unassigned",
          entity_name: version.entity_name || "Unassigned Versions",
          versions: [],
        };
      }

      acc[key].versions.push(version);
      return acc;
    }, {});

    res.json(Object.values(grouped));
  } catch (err) {
    console.error("Get project versions grouped error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

/* ===== Create Shots In project_shots ===== */
app.post("/shots", async (req, res) => {
  try {
    const {
      projectId,
      sequenceId = null,
      shotName,
      status = "Not Started",
      description = "",
    } = req.body;

    // 🔒 Validate input
    if (!projectId || !shotName) {
      return res.status(400).json({
        message: "projectId and shotName are required",
      });
    }

    // 🔒 Ensure project exists (กัน FK chain พัง)
    const [project] = await db.execute(
      "SELECT id FROM projects WHERE id = ? LIMIT 1",
      [projectId],
    );

    if (project.length === 0) {
      return res.status(400).json({
        message: "Project not found",
        projectId,
      });
    }

    // ✅ Insert shot
    const [result] = await db.execute(
      `
      INSERT INTO project_shots
        (project_id, sequence_id, shot_name, status, description, created_at)
      VALUES (?, ?, ?, ?, ?, NOW())
      `,
      [projectId, sequenceId, shotName, status, description],
    );

    const shotId = result.insertId;

    // ✅ ส่ง shotId ชัด ๆ (ใช้ต่อกับ upload)
    res.status(201).json({
      message: "Shot created",
      shot: {
        id: shotId,
        projectId,
        sequenceId,
        shotName,
        status,
        description,
      },
    });
  } catch (err) {
    console.error("Create shot error:", err);
    res.status(500).json({
      message: "Failed to create shot",
      error: err.message,
    });
  }
});

/* ===== Select Shots Where Project ID ===== */
app.get("/shots/:projectId", async (req, res) => {
  try {
    const [shots] = await db.execute(
      `SELECT s.*, seq.sequence_name 
       FROM project_shots s
       LEFT JOIN project_sequences seq ON s.sequence_id = seq.id
       WHERE s.project_id = ?
       ORDER BY s.id`,
      [req.params.projectId],
    );
    res.json({ shots });
  } catch (err) {
    console.error("Get shots error:", err);
    res.status(500).json({ message: "Failed to fetch shots" });
  }
});

/* ===== Update Shots Status ===== */
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

/* ===== Delete Shots In project_shots ===== */
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

// เส้นที่ 1 - ถูกต้องแล้ว (POST)
app.post("/get-shot-null", async (req, res) => {
  try {
    const { projectId } = req.body;

    if (!projectId) {
      return res.status(400).json({
        success: false,
        message: "projectId is required",
      });
    }

    const [shots] = await db.execute(
      `SELECT 
                id,
                shot_name,
                status,
                description,
                created_at
            FROM project_shots 
            WHERE project_id = ? AND sequence_id IS NULL
            ORDER BY created_at DESC`,
      [projectId],
    );

    res.json({
      success: true,
      data: shots,
    });
  } catch (error) {
    console.error("Get shot null error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch shots",
      error: error.message,
    });
  }
});

// เส้นที่ 2 - แก้เป็น PUT (ใส่ sequence_id แทน NULL)
app.put("/add-shot-to-sequence", async (req, res) => {
  try {
    const { sequenceId, shotId } = req.body;

    // Validation
    if (!sequenceId || !shotId) {
      return res.status(400).json({
        success: false,
        message: "sequenceId and shotId are required",
      });
    }

    // ตรวจสอบว่า shot มีอยู่จริง
    const [shotCheck] = await db.execute(
      `SELECT id FROM project_shots WHERE id = ?`,
      [shotId],
    );

    if (shotCheck.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Shot not found",
      });
    }

    // ตรวจสอบว่า sequence มีอยู่จริง
    const [sequenceCheck] = await db.execute(
      `SELECT id FROM project_sequences WHERE id = ?`,
      [sequenceId],
    );

    if (sequenceCheck.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Sequence not found",
      });
    }

    // อัพเดท sequence_id ของ shot (แทน NULL ด้วย sequenceId)
    const [result] = await db.execute(
      `UPDATE project_shots 
            SET sequence_id = ? 
            WHERE id = ?`,
      [sequenceId, shotId],
    );

    if (result.affectedRows === 0) {
      return res.status(500).json({
        success: false,
        message: "Failed to link shot to sequence",
      });
    }

    res.json({
      success: true,
      message: "Shot linked to sequence successfully",
      data: {
        shotId,
        sequenceId,
      },
    });
  } catch (error) {
    console.error("Add shot to sequence error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to link shot",
      error: error.message,
    });
  }
});

// เส้นที่ 3 - PUT (ตั้งค่า sequence_id กลับเป็น NULL)
app.put("/remove-shot-from-sequence", async (req, res) => {
  try {
    const { shotId } = req.body;

    if (!shotId) {
      return res.status(400).json({
        success: false,
        message: "shotId is required",
      });
    }

    // ตรวจสอบว่า shot มีอยู่จริง
    const [shotCheck] = await db.execute(
      `SELECT id, sequence_id FROM project_shots WHERE id = ?`,
      [shotId],
    );

    if (shotCheck.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Shot not found",
      });
    }

    if (!shotCheck[0].sequence_id) {
      return res.status(400).json({
        success: false,
        message: "Shot is not linked to any sequence",
      });
    }

    // ตั้งค่า sequence_id เป็น NULL (ถอดออกจาก sequence)
    const [result] = await db.execute(
      `UPDATE project_shots 
            SET sequence_id = NULL 
            WHERE id = ?`,
      [shotId],
    );

    if (result.affectedRows === 0) {
      return res.status(500).json({
        success: false,
        message: "Failed to remove shot from sequence",
      });
    }

    res.json({
      success: true,
      message: "Shot removed from sequence successfully",
      data: {
        shotId,
        removed: true,
      },
    });
  } catch (error) {
    console.error("Remove shot from sequence error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to remove shot",
      error: error.message,
    });
  }
});

/* ===== Select Shots Where Project ID ===== */
app.post("/shotlist", async (req, res) => {
  try {
    const { projectId } = req.body;

    if (!projectId) {
      return res.status(400).json({ message: "projectId required" });
    }

    const [rows] = await db.execute(
      `
      SELECT 
        s.id,
        s.sequence_id,
        q.sequence_name,
        s.shot_name,
        s.description,
        s.status,
        s.order_index,
        s.file_url
      FROM project_shots s
      LEFT JOIN project_sequences q ON q.id = s.sequence_id
      WHERE s.project_id = ?
      ORDER BY 
        IFNULL(q.order_index, 9999) ASC,
        s.order_index ASC
      `,
      [projectId],
    );

    const grouped = rows.reduce((acc, r) => {
      const categoryName = r.sequence_id ? r.sequence_name : "No Sequence";

      if (!acc[categoryName]) {
        acc[categoryName] = {
          category: categoryName,
          count: 0,
          shots: [],
        };
      }

      acc[categoryName].shots.push({
        id: r.id,
        shot_name: r.shot_name,
        description: r.description,
        status: r.status,
        order_index: r.order_index,
        sequence_id: r.sequence_id, // จะเป็น null ได้
        file_url: r.file_url,
      });

      acc[categoryName].count++;
      return acc;
    }, {});

    res.json(Object.values(grouped));
  } catch (err) {
    console.error("Shotlist error:", err);
    res.status(500).json({ message: err.message });
  }
});

/* ===== Select Assets Where Project ID ===== */
app.post("/assetlist", async (req, res) => {
  try {
    const { projectId } = req.body;
    if (!projectId) {
      return res.status(400).json({ message: "projectId required" });
    }

    const [rows] = await db.execute(
      `
      SELECT
        a.id,
        a.asset_name,
        a.description,
        a.status,
        a.order_index,
        a.type,
        a.file_url
      FROM project_assets a
      WHERE a.project_id = ?
      ORDER BY a.type ASC, a.order_index ASC
      `,
      [projectId],
    );

    const grouped = {};

    for (const row of rows) {
      const category = row.type || "No Type";

      if (!grouped[category]) {
        grouped[category] = {
          category,
          count: 0,
          assets: [],
        };
      }

      grouped[category].assets.push({
        id: row.id,
        asset_name: row.asset_name,
        description: row.description,
        status: row.status,
        file_url: row.file_url,
        type: row.type,
        order_index: row.order_index,
      });

      grouped[category].count++;
    }

    res.json(Object.values(grouped));
  } catch (err) {
    console.error("Assetlist error:", err);
    res.status(500).json({ message: err.message });
  }
});

app.post("/get-asset-sequences-join", async (req, res) => {
  try {
    const { assetId } = req.body;

    const query = `
  SELECT 
    aseq.id as id,  -- เพิ่ม ID ของ link record
    ps.id as sequence_id,
    ps.sequence_name,
    ps.description as sequence_description,
    ps.status as sequence_status,
    ps.created_at as sequence_created_at,
    ps.file_url as sequence_file_url,
    aseq.created_at as linked_at
  FROM asset_sequences aseq
  INNER JOIN project_sequences ps ON aseq.sequence_id = ps.id
  WHERE aseq.asset_id = ?
  ORDER BY aseq.created_at DESC
`;

    const [sequences] = await db.query(query, [assetId]);

    res.json(sequences);
  } catch (error) {
    console.error("Error fetching asset sequences:", error);
    res.status(500).json({ error: "Failed to fetch sequences" });
  }
});

// แก้ไข endpoint ที่มีอยู่
app.post("/get-asset-shots-join", async (req, res) => {
  try {
    const { assetId } = req.body;

    // ถ้า assetId เป็น null ให้ดึง shots ทั้งหมด
    if (!assetId || assetId === "all") {
      const query = `
        SELECT 
          ps.id,
          ps.shot_name,
          ps.description,
          ps.status,
          ps.file_url,
          ps.created_at
        FROM project_shots ps
        ORDER BY ps.created_at DESC
      `;

      const [shots] = await db.query(query);
      return res.json(shots);
    }

    // ถ้ามี assetId ให้ดึง shots ที่เชื่อมกับ asset นั้น
    const query = `
      SELECT 
        aseq.id as id,  
        ps.id as shot_id,
        ps.shot_name,
        ps.description as shot_description,
        ps.status as shot_status,
        ps.created_at as shot_created_at,
        ps.file_url as shot_file_url,
        aseq.created_at as linked_at
      FROM asset_shots aseq
      INNER JOIN project_shots ps ON aseq.shot_id = ps.id
      WHERE aseq.asset_id = ?
      ORDER BY aseq.created_at DESC
    `;

    const [shots] = await db.query(query, [assetId]);

    res.json(shots);
  } catch (error) {
    console.error("Error fetching asset shots:", error);
    res.status(500).json({ error: "Failed to fetch shots" });
  }
});

/* ===== Create Assets In project_shots ===== */
app.post("/createasset", async (req, res) => {
  try {
    const {
      projectId,
      assetName,
      description,
      sequenceId,
      shotId,
      taskTemplate,
      type,
    } = req.body;

    if (!projectId || !assetName) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const safeSequenceId = sequenceId ?? null;
    const safeShotId = shotId ?? null;
    const safetasktemplate = taskTemplate ?? null;
    const safeType = type ?? null;

    const [[{ maxOrder }]] = await db.execute(
      `
      SELECT COALESCE(MAX(order_index), 0) AS maxOrder
      FROM project_assets
      WHERE project_id = ?
        AND sequence_id <=> ?
        AND shot_id <=> ?
      `,
      [projectId, safeSequenceId, safeShotId],
    );

    const nextOrder = maxOrder + 1;

    const [result] = await db.execute(
      `
      INSERT INTO project_assets
      (project_id, asset_name, description, sequence_id, shot_id, status, order_index, taskTemplate, type)
      VALUES (?, ?, ?, ?, ?, 'wtg', ?, ?, ?)
      `,
      [
        projectId,
        assetName,
        description ?? "",
        safeSequenceId,
        safeShotId,
        nextOrder,
        safetasktemplate,
        safeType,
      ],
    );

    res.json({
      message: "Asset created successfully",
      assetId: result.insertId,
      order_index: nextOrder,
    });
  } catch (err) {
    console.error("Create asset error:", err);
    res.status(500).json({ message: err.message });
  }
});

/* ===== Create Shots In project_shots ===== */
app.post("/createshot", async (req, res) => {
  try {
    const { projectId, sequenceId, shotName, description } = req.body;

    if (!projectId || !shotName) {
      return res.status(400).json({ message: "Missing required fields" });
    }
    const safesequenceId = sequenceId ?? null;

    const [[{ maxOrder }]] = await db.execute(
      "SELECT COALESCE(MAX(order_index), 0) AS maxOrder FROM project_shots WHERE project_id = ? AND sequence_id = ?",
      [projectId, safesequenceId],
    );

    const nextOrder = maxOrder + 1;

    const [result] = await db.execute(
      "INSERT INTO project_shots (project_id, sequence_id, shot_name, description, status, order_index) VALUES (?, ?, ?, ?, 'wtg', ?)",
      [projectId, safesequenceId, shotName, description || "", nextOrder],
    );

    res.json({
      message: "Shot created successfully",
      shotId: result.insertId,
      order_index: nextOrder,
    });
  } catch (err) {
    console.error("Create shot error:", err);
    res.status(500).json({ message: err.message });
  }
});

/* ===== Create Task Auto Default ===== */
app.post("/create-task-assets", async (req, res) => {
  try {
    const { projectId, entity_type, entity_id, typeNum } = req.body;

    if (!projectId || !entity_type || !entity_id || typeNum === undefined) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const statusAuto = "wtg";

    // pipeline_step_id map (from pipeline_steps table, asset type)
    const assetStepIdMap = {
      "Design": 1,
      "Art": 2,
      "Model": 3,
      "Rig": 4,
      "Texture": 5,
      "Character FX": 21,
      "Animation": 22,
      "Clay": 23,
      "Visualization": 24,
      "Class-A": 25,
      "Groom": 21,
      "Cloth": 21,
      "Concept": 2,
    };

    let taskNames = [];

    if (typeNum === 0) {
      taskNames = ["Design"];
    } else if (typeNum === 1) {
      taskNames = ["Visualization", "Class-A"];
    } else if (typeNum === 2) {
      taskNames = ["Design", "Model", "Clay", "Visualization"];
    } else if (typeNum === 3) {
      taskNames = ["Model", "Rig", "Texture", "Character FX", "Animation"];
    } else if (typeNum === 4) {
      taskNames = ["Design", "Model", "Texture", "Rig"];
    } else if (typeNum === 5) {
      taskNames = ["Design", "Model", "Clay", "Texture", "Rig", "Animation"];
    } else if (typeNum === 6) {
      taskNames = ["Model", "Clay", "Design", "Texture", "Rig", "Animation"];
    } else if (typeNum === 7) {
      taskNames = ["Design", "Model", "Clay", "Rig", "Animation", "Texture"];
    } else if (typeNum === 8) {
      taskNames = ["Groom", "Cloth", "Rig", "Texture" ,"Model", "Concept", ];
    } else {
      return res.status(400).json({ message: "Invalid typeNum" });
    }

    const values = taskNames.map((task) => [
      projectId,
      entity_type,
      entity_id,
      task,
      assetStepIdMap[task] ?? null,  // pipeline_step_id
      statusAuto,
      new Date(),
    ]);

    await db.query(
      `
      INSERT INTO tasks
      (project_id, entity_type, entity_id, task_name, pipeline_step_id, status, created_at)
      VALUES ?
      `,
      [values],
    );

    res.json({
      message: "Asset tasks created",
      tasks: taskNames,
    });
  } catch (err) {
    console.error("CREATE TASK ASSET ERROR ❌", err);
    res.status(500).json({ message: err.message });
  }
});

/* ===== Create Task Auto Default ===== */
app.post("/create-task-shots", async (req, res) => {
  try {
    const { projectId, entity_type, entity_id, typeNum } = req.body;

    if (!projectId || !entity_type || !entity_id || typeNum === undefined) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const statusAuto = "wtg";

    // pipeline_step_id map (from pipeline_steps table, shot type)
    const shotStepIdMap = {
      "Online": 6,
      "Tracking": 7,
      "Roto": 8,
      "Layout": 9,
      "Animation": 10,
      "Character FX": 11,
      "FX": 12,
      "Light": 13,
      "Comp": 14,
      "Post": 26,
      "Shot": 27,
      "Paint": 14,
      "Plate Online": 6,
      "Hair": 11,
      "Cloth": 11,
      "Lighting": 13,
      "Footage": 26,
    };

    let taskNames = [];

    if (typeNum === 0) {
      taskNames = ["Layout", "Animation", "FX", "Light", "Comp"];
    } else if (typeNum === 1) {
      taskNames = ["Plate Online", "Comp", "Roto", "Paint"];
    } else if (typeNum === 2) {
      taskNames = ["Roto", "Tracking", "Animation", "Layout", "Plate Online", "Hair", "FX", "Lighting", "Comp", "Cloth"];
    } else if (typeNum === 3) {
      taskNames = ["Tracking", "Roto", "Animation", "Plate Online", "Layout", "Comp", "FX"];
    } else if (typeNum === 4) {
      taskNames = ["Layout", "Lighting", "Footage", "Comp", "Animation", "FX" ,"Hair", "Cloth" ,"Shot" ,"Tracking" ,"Roto"];
    } else {
      return res.status(400).json({ message: "Invalid typeNum" });
    }

    const values = taskNames.map((task) => [
      projectId,
      entity_type,
      entity_id,
      task,
      shotStepIdMap[task] ?? null,
      statusAuto,
      new Date(),
    ]);

    await db.query(
      `
      INSERT INTO tasks
      (project_id, entity_type, entity_id, task_name, pipeline_step_id, status, created_at)
      VALUES ?
      `,
      [values],
    );

    res.json({
      message: "Shot tasks created",
      tasks: taskNames,
    });
  } catch (err) {
    console.error("CREATE TASK SHOT ERROR ❌", err);
    res.status(500).json({ message: err.message });
  }
});

/* ===== Update Shots Name, Description, status ===== */
app.post("/updateshot", async (req, res) => {
  try {
    const { shotId, field, value } = req.body;

    const allowedFields = [
      "shot_name",
      "description",
      "status",
      "order_index",
      "sequence_id",
    ];

    if (!shotId || !allowedFields.includes(field)) {
      return res.status(400).json({ message: "Invalid request" });
    }

    await db.execute(`UPDATE project_shots SET ${field} = ? WHERE id = ?`, [
      value,
      Number(shotId),
    ]);

    res.json({ message: "Shot updated successfully" });
  } catch (err) {
    console.error("Update shot error:", err);
    res.status(500).json({ message: err.message });
  }
});

/* ===== Update Assets Name, Description, status ===== */
app.post("/updateasset", async (req, res) => {
  try {
    const { assetId, field, value } = req.body;

    const allowedFields = [
      "asset_name",
      "description",
      "status",
      "order_index",
      "sequence_id",
      "shot_id",
      "type",
    ];

    if (!assetId || !allowedFields.includes(field)) {
      return res.status(400).json({ message: "Invalid request" });
    }

    await db.execute(`UPDATE project_assets SET ${field} = ? WHERE id = ?`, [
      value,
      Number(assetId),
    ]);

    res.json({ message: "Asset updated successfully" });
  } catch (err) {
    console.error("Update asset error:", err);
    res.status(500).json({ message: err.message });
  }
});

app.post("/all-project-files", async (req, res) => {
  const projectId = req.query.project_id ?? req.query.projectId ?? null;

  try {
    const params = projectId ? [projectId] : [];

    // ── 1. files_asset ────────────────────────────────────────────────────────
    const assetWhere = projectId ? "WHERE pa.project_id = ?" : "";
    const assetQuery = `
      SELECT
        fa.id                  AS id,
        fa.file_name           AS file_name,
        fa.download_url        AS download_url,
        fa.type                AS type,
        fa.description         AS file_description,
        fa.created_at          AS file_created_at,
        fa.version_id          AS version_id,
        fa.note_id             AS note_id,

        pa.id                  AS linked_id,
        pa.asset_name          AS linked_name,
        pa.description         AS asset_description,
        pa.status              AS asset_status,
        'asset'                AS source,

        v.version_number       AS version_number,
        v.version_name         AS version_name,
        v.status               AS version_status,
        v.file_size            AS version_file_size,
        v.description          AS version_description,
        v.created_at           AS version_created_at,
        v.task_id              AS version_task_id,

        t.description          AS task_description,
        t.task_name            AS task_name,

        n.subject              AS note_subject,

        p.id                   AS uploader_id,
        p.name                 AS uploader_name,
        p.email                AS uploader_email

      FROM files_asset fa
      INNER JOIN project_assets pa ON fa.asset_id = pa.id
      LEFT  JOIN versions v  ON v.id = fa.version_id
      LEFT  JOIN tasks    t  ON t.id = v.task_id
      LEFT  JOIN notes    n  ON n.id = fa.note_id
      LEFT  JOIN people   p  ON p.id = v.uploaded_by
      ${assetWhere}
      ORDER BY fa.created_at DESC
    `;

    // ── 2. files_shot ─────────────────────────────────────────────────────────
    const shotWhere = projectId ? "WHERE ps.project_id = ?" : "";
    const shotQuery = `
      SELECT
        fs.id                  AS id,
        fs.file_name           AS file_name,
        fs.download_url        AS download_url,
        fs.type                AS type,
        fs.description         AS file_description,
        fs.created_at          AS file_created_at,
        fs.version_id          AS version_id,
        fs.note_id             AS note_id,

        ps.id                  AS linked_id,
        ps.shot_name           AS linked_name,
        ps.description         AS shot_description,
        'shot'                 AS source,

        v.version_number       AS version_number,
        v.version_name         AS version_name,
        v.status               AS version_status,
        v.file_size            AS version_file_size,
        v.description          AS version_description,
        v.created_at           AS version_created_at,
        v.task_id              AS version_task_id,

        t.description          AS task_description,
        t.task_name            AS task_name,

        n.subject              AS note_subject,

        p.id                   AS uploader_id,
        p.name                 AS uploader_name,
        p.email                AS uploader_email

      FROM files_shot fs
      INNER JOIN project_shots ps ON fs.shot_id = ps.id
      LEFT  JOIN versions v  ON v.id = fs.version_id
      LEFT  JOIN tasks    t  ON t.id = v.task_id
      LEFT  JOIN notes    n  ON n.id = fs.note_id
      LEFT  JOIN people   p  ON p.id = v.uploaded_by
      ${shotWhere}
      ORDER BY fs.created_at DESC
    `;

    // ── run sequentially so the error log shows WHICH query failed ────────────
    let assetRows = [];
    let shotRows  = [];

    try {
      console.log("[/all-project-files] running assetQuery...");
      [assetRows] = await db.query(assetQuery, params);
      console.log(`[/all-project-files] assetQuery OK — ${assetRows.length} rows`);
    } catch (e) {
      console.error("[/all-project-files] assetQuery FAILED:", e.message);
      console.error("SQL:", assetQuery);
      throw e;
    }

    try {
      console.log("[/all-project-files] running shotQuery...");
      [shotRows] = await db.query(shotQuery, params);
      console.log(`[/all-project-files] shotQuery OK — ${shotRows.length} rows`);
    } catch (e) {
      console.error("[/all-project-files] shotQuery FAILED:", e.message);
      console.error("SQL:", shotQuery);
      throw e;
    }

    // ── Normalise ─────────────────────────────────────────────────────────────
    const normalise = (rows, source) =>
      rows.map((r) => ({
        id:           r.id,
        source,
        file_name:    r.file_name,
        download_url: r.download_url,
        type:         r.type ?? null,

        // fallback chain:
        // image/video → use asset/shot description directly
        // other types → file desc → note subject → version desc → task desc
        description: (() => {
          const isMediaType = /^(image|video)$/i.test(r.type ?? "");
          if (isMediaType) {
            return (
              r.asset_description?.trim() ||
              r.shot_description?.trim()  ||
              r.file_description?.trim()  ||
              r.note_subject?.trim()      ||
              r.version_description?.trim() ||
              r.task_description?.trim()  ||
              null
            );
          }
          return (
            r.file_description?.trim()    ||
            r.note_subject?.trim()        ||
            r.version_description?.trim() ||
            r.task_description?.trim()    ||
            null
          );
        })(),

        created_at:    r.file_created_at,
        thumbnail_url: /\.(jpe?g|png|gif|webp)$/i.test(r.download_url ?? "")
          ? r.download_url
          : null,

        linked_entity: {
          id:          r.linked_id,
          name:        r.linked_name ?? "—",
          type:        source,
          description: source === "asset"
            ? (r.asset_description ?? null)
            : (r.shot_description  ?? null),
        },

        version: r.version_id
          ? {
              id:               r.version_id,
              number:           r.version_number,
              name:             r.version_name,
              status:           r.version_status    ?? null,
              file_size:        r.version_file_size ?? null,
              description:      r.version_description ?? null,
              task_description: r.task_description  ?? null,
              task_name:        r.task_name          ?? null,
              created_at:       r.version_created_at ?? null,
              task_id:          r.version_task_id    ?? null,
            }
          : null,

        note: r.note_id
          ? {
              id:      r.note_id,
              subject: r.note_subject ?? null,
            }
          : null,

        uploaded_by: r.uploader_id
          ? {
              id:    r.uploader_id,
              name:  r.uploader_name  ?? null,
              email: r.uploader_email ?? null,
            }
          : null,
      }));

    const asset_files = normalise(assetRows, "asset");
    const shot_files  = normalise(shotRows,  "shot");

    console.log(`[/all-project-files] done — ${asset_files.length} asset files, ${shot_files.length} shot files`);

    return res.json({
      asset_files,
      shot_files,
      total: asset_files.length + shot_files.length,
    });

  } catch (err) {
    console.error("[/all-project-files] ERROR:", err.message);
    return res.status(500).json({
      message:  "Internal server error",
      error:    err.message,
      sqlState: err.sqlState ?? null,
      errno:    err.errno    ?? null,
      sql:      err.sql      ?? null,
    });
  }
});

app.post('/get-note-tasks', async (req, res) => {
  const { entity_type, entity_id, project_id } = req.body;

  if (!entity_type || !entity_id) {
    return res.status(400).json({ error: 'entity_type and entity_id are required' });
  }

  try {
    let sql = `
      SELECT
        t.id,
        t.project_id,
        t.entity_type,
        t.entity_id,
        t.task_name,
        t.status,
        t.start_date,
        t.due_date,
        t.description,
        t.created_at,
        t.pipeline_step_id,
        ps.step_name AS pipeline_step_name
      FROM tasks t
      LEFT JOIN pipeline_steps ps ON ps.id = t.pipeline_step_id
      WHERE t.entity_type = ? AND t.entity_id = ?
    `;
    const params = [entity_type, entity_id];

    if (project_id) {
      sql += ' AND t.project_id = ?';
      params.push(project_id);
    }

    sql += ' ORDER BY t.created_at DESC';

    const [rows] = await db.execute(sql, params);
    return res.json(rows);
  } catch (err) {
    console.error('[GET /tasks/entity]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// CREATE comment
app.post("/note-comments/create", async (req, res) => {
    const { noteId, author, body, fileUrl, fileUrls } = req.body;
    if (!noteId || !author || !body?.trim()) {
        return res.status(400).json({ message: "noteId, author, body required" });
    }

    try {
        // เก็บ fileUrls เป็น JSON string ใน file_url column เดิม
        const fileUrlValue = fileUrls?.length > 1
            ? JSON.stringify(fileUrls)        // หลายไฟล์ → JSON array string
            : (fileUrl ?? null);              // ไฟล์เดียว → string ปกติ

        const [result] = await db.execute(
            `INSERT INTO note_comments (note_id, author, body, file_url, created_at)
             VALUES (?, ?, ?, ?, NOW())`,
            [noteId, author, body.trim(), fileUrlValue]
        );
        const [rows] = await db.execute(
            `SELECT * FROM note_comments WHERE id = ?`,
            [result.insertId]
        );
        const comment = rows[0];
        res.status(201).json({
            ...comment,
            // parse กลับเป็น array เสมอ
            file_urls: (() => {
                try {
                    if (!comment.file_url) return [];
                    const parsed = JSON.parse(comment.file_url);
                    return Array.isArray(parsed) ? parsed : [comment.file_url];
                } catch {
                    return comment.file_url ? [comment.file_url] : [];
                }
            })(),
        });
    } catch (err) {
        console.error('❌ note-comments/create:', err.message);
        res.status(500).json({ message: err.message });
    }
});

// GET comments
app.post("/note-comments", async (req, res) => {
    const { noteId } = req.body;
    if (!noteId) return res.status(400).json({ message: "noteId required" });

    try {
        const [rows] = await db.execute(
            `SELECT * FROM note_comments WHERE note_id = ? ORDER BY created_at ASC`,
            [noteId]
        );
        const parsed = rows.map(row => ({
            ...row,
            file_urls: (() => {
                try {
                    if (!row.file_url) return [];
                    const p = JSON.parse(row.file_url);
                    return Array.isArray(p) ? p : [row.file_url];
                } catch {
                    return row.file_url ? [row.file_url] : [];
                }
            })(),
        }));
        res.json(parsed);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// DELETE comment
app.delete("/note-comments/:commentId", async (req, res) => {
    const { commentId } = req.params;
    try {
        // ดึง comment ก่อนเพื่อรู้ว่า note นี้เป็น type อะไร
        const [comments] = await db.execute(
            `SELECT nc.*, n.note_type, n.type_id 
             FROM note_comments nc
             JOIN notes n ON nc.note_id = n.id
             WHERE nc.id = ?`,
            [commentId]
        );

        if (comments.length > 0) {
            const comment = comments[0];

            // map note_type → files table
            const fileTableMap = {
                sequence: { table: 'files_sequence', fkCol: 'sequence_id' },
                shot:     { table: 'files_shot',     fkCol: 'shot_id'     },
                asset:    { table: 'files_asset',    fkCol: 'asset_id'    },
            };

            const fileTable = fileTableMap[comment.note_type];

            if (fileTable && comment.file_url) {
                // parse file_url → array of paths
                let fileUrls = [];
                try {
                    const parsed = JSON.parse(comment.file_url);
                    fileUrls = Array.isArray(parsed) ? parsed : [comment.file_url];
                } catch {
                    fileUrls = [comment.file_url];
                }

                // ลบ records ใน files_* ที่ type = 'comment' และ download_url ตรงกัน
                for (const url of fileUrls) {
                    await db.execute(
                        `DELETE FROM ${fileTable.table} 
                         WHERE ${fileTable.fkCol} = ? AND download_url = ? AND type = 'comment'`,
                        [comment.type_id, url]
                    );
                }
            }
        }

        // ลบ comment
        await db.execute(`DELETE FROM note_comments WHERE id = ?`, [commentId]);
        res.json({ message: "Deleted" });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

/* ===== Update Shots Order Index Where Shot ID ===== */
app.post("/shots/reorder", async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { shots } = req.body;

    if (!Array.isArray(shots)) {
      return res.status(400).json({ message: "Invalid data format" });
    }

    await conn.beginTransaction();

    for (const shot of shots) {
      await conn.execute(
        "UPDATE project_shots SET order_index = ? WHERE id = ?",
        [shot.order_index, shot.id],
      );
    }

    await conn.commit();
    res.json({ message: "Shots reordered successfully" });
  } catch (err) {
    await conn.rollback();
    console.error("Reorder shots error:", err);
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
});

/* ===== Select all people ===== */
app.get("/getallpeople", async (req, res) => {
  try {

    const [rows] = await db.execute(
      `SELECT *
       FROM people 
       ORDER BY created_at DESC`

    );

    res.json(rows);
  } catch (err) {
    console.error("Get people error:", err);
    res.status(500).json({ message: "Database error", error: err.message });
  }
});

/* ===== Select people Where Project ID ===== */
app.post("/getpeople", async (req, res) => {
  try {


    const [rows] = await db.execute(
      `SELECT id, name, email, status, permission_group as permissionGroup,  
              groups_name as \`groups\`, created_at as createdAt
       FROM people 
       ORDER BY created_at DESC`,

    );

    res.json(rows);
  } catch (err) {
    console.error("Get people error:", err);
    res.status(500).json({ message: "Database error", error: err.message });
  }
});

/* ===== Create People(Add Members to Project) ===== */
app.post("/people", async (req, res) => {
  try {
    const {
      name,
      email,
      status = "Active",
      permissionGroup = "Artist",
      groups = "",

    } = req.body;

    if (!name || !email) {
      return res.status(400).json({ message: "Name and email are required" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    /* =========================================
       2️⃣ email ห้ามซ้ำใน project เดียวกัน
    ========================================== */
    const [existing] = await db.execute(
      "SELECT id FROM people WHERE email = ?",
      [email],
    );

    if (existing.length > 0) {
      return res.status(409).json({
        message: "Email already exists in this project",
      });
    }

    /* =================
       3️⃣ INSERT people
    ================== */
    const [result] = await db.execute(
      `INSERT INTO people 
       (name, email, status, permission_group,  groups_name)
       VALUES (?, ?, ?, ?, ?)`,
      [name, email, status, permissionGroup, groups],
    );

    res.status(201).json(result);
  } catch (err) {
    console.error("Create person error:", err);
    res.status(500).json({
      message: "Failed to create person",
      error: err.message,
    });
  }
});

/* ===== Update people pemission_group Where ID(from field) permission(from User) email(from User) ===== */
app.put("/people/:id", async (req, res) => {
  try {
    const targetId = req.params.id;
    const { permission, email } = req.body;

    if (!targetId || isNaN(targetId)) {
      return res.status(400).json({ message: "Invalid target ID" });
    }

    /* ===== permission logic (2 cases) ===== */
    if (permission !== "Owner") {
      if (!email) {
        return res.status(400).json({ message: "Missing email" });
      }

      const [actorRows] = await db.execute(
        "SELECT permission_group FROM people WHERE email = ?",
        [email],
      );

      if (actorRows.length === 0) {
        return res.status(403).json({ message: "Actor not found" });
      }

      if (actorRows[0].permission_group !== "Admin") {
        return res.status(403).json({ message: "Permission denied" });
      }
    }
    // permission === "Owner" → ผ่านทันที

    /* ===== mapping field ===== */
    const fieldMapping = {
      name: "name",
      email: "email",
      status: "status",
      permissionGroup: "permission_group",
      projects: "projects",
      groups: "groups_name",
    };

    const updateBody = { ...req.body };
    delete updateBody.permission;
    delete updateBody.actorEmail;

    const frontendField = Object.keys(updateBody)[0];
    const value = updateBody[frontendField];

    if (!frontendField || value === undefined) {
      return res.status(400).json({ message: "No field to update" });
    }

    const dbColumn = fieldMapping[frontendField];
    if (!dbColumn) {
      return res.status(400).json({ message: "Invalid field" });
    }

    /* ===== validation ===== */
    if (frontendField === "status" && !["Active", "Inactive"].includes(value)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    if (frontendField === "email") {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        return res.status(400).json({ message: "Invalid email format" });
      }
    }

    await db.execute(`UPDATE people SET ${dbColumn} = ? WHERE id = ?`, [
      value,
      targetId,
    ]);

    res.json({ message: "Person updated successfully" });
  } catch (err) {
    console.error("Update person error:", err);
    res.status(500).json({
      message: "Failed to update person",
      error: err.message,
    });
  }
});

/* ===== Update people Status Where ID(from field) permission(from User) email(from User) ===== */
app.put("/statuspeople", async (req, res) => {
  try {
    const { id, status, permission, email } = req.body;

    if (!id || !status) {
      return res.status(400).json({
        message: "Missing id or status",
      });
    }

    if (!["Active", "Inactive"].includes(status)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    /* ===== permission logic (2 cases) ===== */
    if (permission !== "Owner") {
      if (!email) {
        return res.status(400).json({ message: "Missing email" });
      }

      const [actorRows] = await db.execute(
        "SELECT permission_group FROM people WHERE email = ?",
        [email],
      );

      if (actorRows.length === 0) {
        return res.status(403).json({ message: "Actor not found" });
      }

      if (actorRows[0].permission_group !== "Admin") {
        return res.status(403).json({ message: "Permission denied" });
      }
    }
    // permission === "Owner" → ผ่านทันที

    await db.execute("UPDATE people SET status = ? WHERE id = ?", [status, id]);

    res.json({ message: "Status updated successfully" });
  } catch (err) {
    console.error("Update status error:", err);
    res.status(500).json({
      message: "Failed to update status",
      error: err.message,
    });
  }
});

/* ===== Delete people Where ID ===== */
app.delete("/delete-people", async (req, res) => {
  try {
    const { peopleId, email, actorEmail, permission } = req.body;

    // ── Permission check ──
    if (permission !== "Owner") {
      if (!actorEmail) {
        return res.status(400).json({ message: "Missing email" });
      }

      const [actorRows] = await db.execute(
        "SELECT permission_group FROM people WHERE email = ?",
        [actorEmail],
      );

      if (actorRows.length === 0) {
        return res.status(403).json({ message: "Actor not found" });
      }

      if (actorRows[0].permission_group !== "Admin") {
        return res.status(403).json({ message: "Permission denied" });
      }
    }

    if (!peopleId || isNaN(peopleId)) {
      return res.status(400).json({ message: "Invalid peopleId" });
    }

    if (!email || email.trim() === "") {
      return res.status(400).json({ message: "Email is required" });
    }

    // ── ลบ userId lookup ออก เพราะไม่ได้ใช้ ──
    // ตรวจสอบใน people table โดยตรง
    const [peopleData] = await db.execute(
      "SELECT id, email FROM people WHERE id = ?",
      [peopleId],
    );

    if (peopleData.length === 0) {
      return res.status(404).json({ message: "Person not found" });
    }

    // เช็ค email ตรงกัน
    if (peopleData[0].email !== email) {
      return res.status(400).json({ message: "Email does not match" });
    }

    // ── ลบ ──
    await db.execute("DELETE FROM people WHERE id = ?", [peopleId]);

    res.json({
      message: "Person deleted successfully",
      peopleId: peopleId,
    });

  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).json({
      message: "Failed to delete person",
      error: err.message,
    });
  }
});

/* ===== Select Total from people Status == Active ===== */
app.get("/seats", async (req, res) => {
  try {
    const [result] = await db.execute(
      "SELECT COUNT(*) as used, 50 as total FROM people WHERE status = 'Active'",
    );

    res.json({
      total: result[0].total,
      used: result[0].used,
      available: result[0].total - result[0].used,
    });
  } catch (err) {
    console.error("Get seats error:", err);
    res
      .status(500)
      .json({ message: "Failed to get seats info", error: err.message });
  }
});

/* ===== Calculate Project Shots (%) ===== */
app.post("/projectDetail-shots/Calculator", async (req, res) => {
  const { projectId } = req.body;

  if (!projectId) {
    return res.status(400).json({ message: "projectId is required" });
  }

  try {
    const [rows] = await db.query(
      `
      SELECT
        COUNT(*) AS totalShots,
        SUM(CASE WHEN status IN ('fin', 'cmpt', 'cfrm', 'cap', 'dlvr') THEN 1 ELSE 0 END) AS completedShots,
        SUM(CASE WHEN status IN ('ip', 'arp', 'rts', 'wtc') THEN 1 ELSE 0 END) AS inProgressShots,
        SUM(CASE WHEN status IN ('wtg', 'hld', 'nef') THEN 1 ELSE 0 END) AS pendingShots
      FROM project_shots
      WHERE project_id = ?
        AND status NOT IN ('omt', 'na', 'vnd')
    `,
      [projectId]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch shot stats" });
  }
});

/* ===== Calculate Project Assets (%) ===== */
app.post("/projectDetail-assets/Calculator", async (req, res) => {
  const { projectId } = req.body;

  if (!projectId) {
    return res.status(400).json({ message: "projectId is required" });
  }

  try {
    const [rows] = await db.query(
      `
      SELECT
        COUNT(*) AS totalAssets,
        SUM(CASE WHEN status IN ('fin', 'cmpt') THEN 1 ELSE 0 END) AS completedAssets,
        SUM(CASE WHEN status IN ('ip', 'rts', 'recd') THEN 1 ELSE 0 END) AS inProgressAssets,
        SUM(CASE WHEN status IN ('wtg', 'hld', 'pndng') THEN 1 ELSE 0 END) AS pendingAssets
      FROM project_assets
      WHERE project_id = ?
    `,
      [projectId]
    );

    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch asset stats" });
  }
});

/* ===== Calculate Project Sequences (%) ===== */
app.post("/projectDetail-sequences/Calculator", async (req, res) => {
  const { projectId } = req.body;

  if (!projectId) {
    return res.status(400).json({ message: "projectId is required" });
  }

  try {
    const [rows] = await db.query(
      `
      SELECT
      COUNT(*) AS totalSequences,
      SUM(CASE WHEN status = 'fin' THEN 1 ELSE 0 END) AS completedSequences,
      SUM(CASE WHEN status = 'ip' THEN 1 ELSE 0 END) AS inProgressSequences,
      SUM(CASE WHEN status = 'wtg' THEN 1 ELSE 0 END) AS pendingSequences
    FROM project_sequences
    WHERE project_id = ?
    `,
      [projectId],
    );

    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch asset stats" });
  }
});

/// +++++++++++++++++++++++++++++++++++++++++++++++++++++ Delete Endpoints +++++++++++++++++++++++++++++++++++++++++++++++++++++ //
app.delete("/project-sequences", async (req, res) => {
  try {
    const { sequenceId } = req.body;
    if (!sequenceId) {
      return res.status(400).json({ message: "sequenceId is required" });
    }

    // 🔹 shots
    const [shots] = await db.execute(
      "SELECT id FROM project_shots WHERE sequence_id = ?",
      [sequenceId],
    );

    for (const shot of shots) {
      const [shotFiles] = await db.execute(
        "SELECT download_url FROM files_shot WHERE shot_id = ?",
        [shot.id],
      );

      for (const file of shotFiles) {
        if (file.download_url?.includes(req.get("host"))) {
          try {
            const url = new URL(file.download_url);
            deleteFile(
              path.join(STORAGE_BASE, url.pathname.replace("/uploads/", "")),
            );
          } catch (err) {
            console.warn("Failed to delete shot image:", err.message);
          }
        }
      }

      await db.execute("DELETE FROM files_shot WHERE shot_id = ?", [shot.id]);
    }

    await db.execute("DELETE FROM project_shots WHERE sequence_id = ?", [
      sequenceId,
    ]);

    // 🔹 sequence image
    const [seq] = await db.execute(
      "SELECT file_url FROM project_sequences WHERE id = ?",
      [sequenceId],
    );

    const fileUrl = seq[0]?.file_url;
    let fileDeleted = false;

    // 2. ลบไฟล์ถ้ามี file_url
    if (fileUrl) {
      try {
        let pathname = fileUrl;

        // ถ้าเป็น URL เต็ม → ดึง pathname
        if (fileUrl.startsWith("http")) {
          pathname = new URL(fileUrl).pathname;
        }

        // ตัด /uploads ออกให้เหลือ path ภายใน storage
        const relativePath = pathname.replace(/^\/?uploads\//, "");
        const fullPath = path.join(STORAGE_BASE, relativePath);

        console.log("🗑️ Deleting file:", fullPath);

        fileDeleted = deleteFile(fullPath);

        if (fileDeleted) {
          console.log("✅ File deleted successfully");
        } else {
          console.warn("⚠️ File not found:", fullPath);
        }
      } catch (err) {
        console.warn("❌ Failed to delete file:", err.message);
      }
    }

    // 🔹 ลบ sequence
    const [result] = await db.execute(
      "DELETE FROM project_sequences WHERE id = ?",
      [sequenceId],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Sequence not found" });
    }

    res.json({ message: "Sequence deleted", sequenceId });
  } catch (err) {
    console.error("Delete sequence error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/project-shots", async (req, res) => {
  try {
    const { shotId } = req.body;
    if (!shotId) {
      return res.status(400).json({ message: "shotId is required" });
    }

    // 🔹 ลบ asset ใน shot
    const [assets] = await db.execute(
      "SELECT id FROM asset_shots WHERE shot_id = ?",
      [shotId],
    );

    for (const asset of assets) {
      const [files] = await db.execute(
        "SELECT download_url FROM files_asset_shot WHERE asset_shot_id = ?",
        [asset.id],
      );

      for (const file of files) {
        if (file.download_url?.includes(req.get("host"))) {
          try {
            const url = new URL(file.download_url);
            deleteFile(
              path.join(STORAGE_BASE, url.pathname.replace("/uploads/", "")),
            );
          } catch (err) {
            console.warn("Failed to delete asset image:", err.message);
          }
        }
      }

      await db.execute("DELETE FROM files_asset_shot WHERE asset_shot_id = ?", [
        asset.id,
      ]);
    }

    await db.execute("DELETE FROM asset_shots WHERE shot_id = ?", [shotId]);

    // 🔹 ลบ shot images
    const [shotFiles] = await db.execute(
      "SELECT download_url FROM files_shot WHERE shot_id = ?",
      [shotId],
    );

    const fileUrl = shotFiles[0]?.download_url;
    let fileDeleted = false;

    // 2. ลบไฟล์ถ้ามี file_url
    if (fileUrl) {
      try {
        let pathname = fileUrl;

        // ถ้าเป็น URL เต็ม → ดึง pathname
        if (fileUrl.startsWith("http")) {
          pathname = new URL(fileUrl).pathname;
        }

        // ตัด /uploads ออกให้เหลือ path ภายใน storage
        const relativePath = pathname.replace(/^\/?uploads\//, "");
        const fullPath = path.join(STORAGE_BASE, relativePath);

        console.log("🗑️ Deleting file:", fullPath);

        fileDeleted = deleteFile(fullPath);

        if (fileDeleted) {
          console.log("✅ File deleted successfully");
        } else {
          console.warn("⚠️ File not found:", fullPath);
        }
      } catch (err) {
        console.warn("❌ Failed to delete file:", err.message);
      }
    }

    await db.execute("DELETE FROM files_shot WHERE shot_id = ?", [shotId]);


    // 🔹 ลบ shot
    const [result] = await db.execute(
      "DELETE FROM project_shots WHERE id = ?",
      [shotId],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Shot not found" });
    }

    await db.execute("DELETE FROM tasks WHERE entity_id = ?", [shotId]);
    await db.execute("DELETE FROM versions WHERE entity_id = ?", [shotId]);
    await db.execute("DELETE FROM notes WHERE type_id = ?", [shotId]);


    res.json({ message: "Shot deleted", shotId });
  } catch (err) {
    console.error("Delete shot error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/project-assets", async (req, res) => {
  try {
    const { assetId } = req.body;
    if (!assetId) {
      return res.status(400).json({ message: "assetId is required" });
    }

    // ดึงไฟล์ asset
    const [files] = await db.execute(
      "SELECT download_url FROM files_asset WHERE asset_id = ?",
      [assetId],
    );

    const fileUrl = files[0]?.download_url;
    let fileDeleted = false;

    // 2. ลบไฟล์ถ้ามี file_url
    if (fileUrl) {
      try {
        let pathname = fileUrl;

        // ถ้าเป็น URL เต็ม → ดึง pathname
        if (fileUrl.startsWith("http")) {
          pathname = new URL(fileUrl).pathname;
        }

        // ตัด /uploads ออกให้เหลือ path ภายใน storage
        const relativePath = pathname.replace(/^\/?uploads\//, "");
        const fullPath = path.join(STORAGE_BASE, relativePath);

        console.log("🗑️ Deleting file:", fullPath);

        fileDeleted = deleteFile(fullPath);

        if (fileDeleted) {
          console.log("✅ File deleted successfully");
        } else {
          console.warn("⚠️ File not found:", fullPath);
        }
      } catch (err) {
        console.warn("❌ Failed to delete file:", err.message);
      }
    }

    // ลบ DB
    await db.execute("DELETE FROM files_asset WHERE asset_id = ?", [assetId]);
    const [result] = await db.execute(
      "DELETE FROM project_assets WHERE id = ?",
      [assetId],
    );

    await db.execute("DELETE FROM tasks WHERE entity_id = ?", [assetId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Asset not found" });
    }

    await db.execute("DELETE FROM tasks WHERE entity_id = ?", [assetId]);
    await db.execute("DELETE FROM versions WHERE entity_id = ?", [assetId]);
    await db.execute("DELETE FROM notes WHERE type_id = ?", [assetId]);


    res.json({ message: "Asset deleted", assetId });
  } catch (err) {
    console.error("Delete asset error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++ //
app.post("/project-sequence-detail", async (req, res) => {
  try {
    const { sequenceId } = req.body;

    if (!sequenceId) {
      return res.status(400).json({ message: "sequenceId is required" });
    }

    const [rows] = await db.execute(
      `SELECT
        s.id AS sequence_id,
        s.sequence_name,
        s.description AS sequence_description,
        s.status AS sequence_status,
        s.created_at AS sequence_created_at,
        s.file_url AS sequence_thumbnail,

        sh.id AS shot_id,
        sh.shot_name,
        sh.status AS shot_status,
        sh.description AS shot_description,
        sh.created_at AS shot_created_at,

        a.id AS asset_id,
        a.asset_name,
        a.status AS asset_status,
        a.description AS asset_description,
        a.created_at AS asset_created_at

      FROM project_sequences s
      LEFT JOIN project_shots sh ON sh.sequence_id = s.id
      LEFT JOIN project_assets a ON a.shot_id = sh.id
      WHERE s.id = ?
      ORDER BY sh.order_index, a.order_index`,
      [sequenceId],
    );

    res.json(rows);
  } catch (err) {
    console.error("Fetch sequence detail error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/project-shot-detail", async (req, res) => {
  try {
    const { shotId } = req.body;

    if (!shotId) {
      return res.status(400).json({ message: "shotId is required" });
    }

    const [rows] = await db.execute(
      `SELECT
        sh.id AS shot_id,
        sh.shot_name,
        sh.description AS shot_description,
        sh.status AS shot_status,
        sh.created_at AS shot_created_at,
        sh.file_url AS shot_thumbnail,

        s.id AS sequence_id,
        s.sequence_name,
        s.status AS sequence_status,
        s.description AS sequence_description,
        s.created_at AS sequence_created_at,

        a.id AS asset_id,
        a.asset_name,
        a.status AS asset_status,
        a.description AS asset_description,
        a.created_at AS asset_created_at

      FROM project_shots sh
      LEFT JOIN project_sequences s ON s.id = sh.sequence_id
      LEFT JOIN project_assets a ON a.shot_id = sh.id
      WHERE sh.id = ?
      ORDER BY a.order_index`,
      [shotId],
    );

    res.json(rows);
  } catch (err) {
    console.error("Fetch shot detail error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/project-asset-detail", async (req, res) => {
  try {
    const { assetId } = req.body;

    if (!assetId) {
      return res.status(400).json({ message: "assetId is required" });
    }

    const [rows] = await db.execute(
      `SELECT
        a.id AS asset_id,
        a.asset_name,
        a.description AS asset_description,
        a.status AS asset_status,
        a.created_at AS asset_created_at,
        a.file_url AS asset_thumbnail,
        a.type AS asset_type,
        s.id AS sequence_id,
        s.sequence_name,    

        s.id AS sequence_id,
        s.sequence_name,
        s.status AS sequence_status,
        s.description AS sequence_description,
        s.created_at AS sequence_created_at,

        sh.id AS shot_id,
        sh.shot_name,
        sh.status AS shot_status,
        sh.description AS shot_description,
        sh.created_at AS shot_created_at

      FROM project_assets a
      LEFT JOIN project_sequences s ON s.id = a.sequence_id
      LEFT JOIN project_shots sh ON sh.id = a.shot_id
      WHERE a.id = ?`,
      [assetId],
    );

    res.json(rows);
  } catch (err) {
    console.error("Fetch asset detail error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// เพิ่มทั้ง 2 endpoints นี้
app.put("/add-sequence-to-shot", async (req, res) => {
  const { shotId, sequenceId } = req.body;

  try {
    if (!shotId || !sequenceId) {
      return res
        .status(400)
        .json({ error: "shotId and sequenceId are required" });
    }

    const [result] = await db.execute(
      `UPDATE project_shots SET sequence_id = ? WHERE id = ?`,
      [sequenceId, shotId],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Shot not found" });
    }

    console.log(`✅ Added sequence ${sequenceId} to shot ${shotId}`);
    res.json({ success: true, message: "Sequence added successfully" });
  } catch (error) {
    console.error("❌ Error adding sequence:", error);
    res.status(500).json({ error: "Failed to add sequence" });
  }
});

app.put("/remove-sequence-from-shot", async (req, res) => {
  const { shotId } = req.body;

  try {
    if (!shotId) {
      return res.status(400).json({ error: "shotId is required" });
    }

    const [result] = await db.execute(
      `UPDATE project_shots SET sequence_id = NULL WHERE id = ?`,
      [shotId],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Shot not found" });
    }

    console.log(`✅ Removed sequence from shot ${shotId}`);
    res.json({ success: true, message: "Sequence removed successfully" });
  } catch (error) {
    console.error("❌ Error removing sequence:", error);
    res.status(500).json({ error: "Failed to remove sequence" });
  }
});

app.post("/get-notes", async (req, res) => {
  try {
    const { projectId, noteId, noteType, typeId } = req.body;

    if (!projectId) {
      return res.status(400).json({ message: "Missing projectId" });
    }

    // 🔥 map table
    const fileJoinMap = {
      sequence: { table: 'files_sequence' },
      shot:     { table: 'files_shot' },
      asset:    { table: 'files_asset' },
    };

    const fileJoin = fileJoinMap[noteType];

    // 🔥 join file ด้วย note_id (ถูกต้อง)
    const fileJoinSQL = fileJoin
      ? `LEFT JOIN ${fileJoin.table} fs ON fs.note_id = n.id`
      : '';

    // 🔥 dynamic WHERE
    const conditions = [];
    const params = [];

    if (noteId) {
      conditions.push("n.id = ?");
      params.push(noteId);
    } else {
      if (!noteType || !typeId) {
        return res.status(400).json({ message: "Missing noteType or typeId" });
      }

      conditions.push("n.note_type = ?");
      conditions.push("n.type_id = ?");
      params.push(noteType, typeId);
    }

    conditions.push("n.project_id = ?");
    params.push(projectId);

    await db.execute("SET SESSION group_concat_max_len = 1000000");

    const [notes] = await db.execute(
      `SELECT 
        n.*,
        GROUP_CONCAT(DISTINCT p.name ORDER BY p.name SEPARATOR ',') AS assigned_people,
        GROUP_CONCAT(DISTINCT fs.download_url ORDER BY fs.id ASC SEPARATOR '||') AS file_urls
       FROM notes n
       LEFT JOIN note_assignments na ON n.id = na.note_id
       LEFT JOIN people p ON na.people_id = p.id
       ${fileJoinSQL}
       WHERE ${conditions.join(" AND ")}
       GROUP BY n.id
       ORDER BY n.created_at DESC`,
      params
    );

    // 🔥 format data
    const result = notes.map((note) => {
      let tasks = [];
      try {
        tasks = note.tasks ? JSON.parse(note.tasks) : [];
      } catch {
        tasks = [];
      }

      return {
        ...note,

        tasks,

        assigned_people: note.assigned_people
          ? note.assigned_people.split(',').filter(Boolean)
          : [],

        file_urls: note.file_urls
          ? note.file_urls.split('||').filter(Boolean)
          : [],
      };
    });

    res.json(result);

  } catch (err) {
    console.error("❌ Get notes error:", err);

    res.status(500).json({
      message: "Server error",
      error: err.message
    });
  }
});


app.post('/create-asset-version', async (req, res) => {
  try {
    console.log('📥 body:', JSON.stringify(req.body, null, 2));

    const {
      entityType,
      entityId,
      version_name,
      status,
      description,
      file_url,
      uploaded_by,
      file_id,
      task_id,   // ← เพิ่มตรงนี้
    } = req.body;

    if (!entityId || !version_name) {
      return res.status(400).json({ message: 'entityId and version_name are required' });
    }

    // หา version_number ถัดไป
    const [rows] = await db.query(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
             FROM versions
             WHERE entity_type = ? AND entity_id = ?`,
      [entityType || 'asset', entityId]
    );
    const version_number = rows[0].next_version;

    console.log('📊 version_number:', version_number);
    console.log('👤 uploaded_by:', uploaded_by);
    console.log('🔗 task_id:', task_id);

    // handle unique version_name
    let finalVersionName = version_name;
    const baseName = version_name.replace(/\s\(\d+\)$/, '').trim();
    const [sameNameRows] = await db.query(
      `SELECT version_name FROM versions
     WHERE entity_type = ? AND entity_id = ?
     AND (version_name = ? OR version_name REGEXP ?)`,
      [entityType || 'asset', entityId, baseName, `^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(\\d+\\)$`]
    );
    if (sameNameRows.length > 0) {
      finalVersionName = `${baseName} (${sameNameRows.length + 1})`;
    }

    const [result] = await db.query(
      `INSERT INTO versions 
                (entity_type, entity_id, version_number, version_name, status, description, file_url, uploaded_by, task_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        entityType || 'asset',
        entityId,
        version_number,
        finalVersionName,
        status || 'wtg',
        description || null,
        file_url || null,
        uploaded_by || null,
        task_id || null,   // ← เพิ่มตรงนี้
      ]
    );

    await db.execute(
      `UPDATE files_asset SET version_id = ? WHERE id = ?`,
      [result.insertId, file_id]
    );

    console.log('✅ inserted id:', result.insertId);

    return res.status(201).json({
      success: true,
      message: 'Version created successfully',
      versionId: result.insertId,
      version_number,
    });

  } catch (error) {
    console.error('❌ error message:', error.message);
    console.error('❌ error sql:', error.sql);
    console.error('❌ error code:', error.code);
    return res.status(500).json({
      message: 'Internal server error',
      error: error.message,
      code: error.code
    });
  }
});

app.post('/create-shot-version', async (req, res) => {
  try {
    console.log('📥 body:', JSON.stringify(req.body, null, 2)); // ← เพิ่ม

    const {
      entityType,
      entityId,
      version_name,
      status,
      description,
      file_url,
      uploaded_by,
      file_id,
      task_id,


    } = req.body;

    if (!entityId || !version_name) {
      return res.status(400).json({ message: 'entityId and version_name are required' });
    }

    // หา version_number ถัดไป
    const [rows] = await db.query(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
             FROM versions
             WHERE entity_type = ? AND entity_id = ?`,
      [entityType || 'shot', entityId]
    );
    const version_number = rows[0].next_version;

    console.log('📊 version_number:', version_number);
    console.log('👤 uploaded_by:', uploaded_by);
    console.log('🔗 task_id:', task_id);

    // handle unique version_name
    // ✅ แก้เป็น
    let finalVersionName = version_name;

    if (finalVersionName && entityId) {
      const baseName = finalVersionName.replace(/\s\(\d+\)$/, '').trim();
      const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const [sameNameRows] = await db.query(
        `SELECT version_name FROM versions
         WHERE entity_type = ? AND entity_id = ?
         AND (version_name = ? OR version_name REGEXP ?)`,
        [
          entityType || 'shot',
          entityId,
          baseName,
          `^${escapedBase} \\(\\d+\\)$`
        ]
      );

      if (sameNameRows.length > 0) {
        finalVersionName = `${baseName} (${sameNameRows.length + 1})`;
      }
    }



    const [result] = await db.query(
      `INSERT INTO versions 
                (entity_type, entity_id, version_number, version_name, status, description, file_url, uploaded_by, task_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        entityType || 'shot',
        entityId,
        version_number,
        finalVersionName,
        status || 'wtg',
        description || null,
        file_url || null,
        uploaded_by || null,
        task_id || null,
      ]
    );


    await db.execute(`UPDATE files_shot SET version_id = ? WHERE id = ?`,
      [result.insertId, file_id]
    );


    console.log('✅ inserted id:', result.insertId);

    return res.status(201).json({
      success: true,
      message: 'Version created successfully',
      versionId: result.insertId,
      version_number,
    });

  } catch (error) {
    console.error('❌ error message:', error.message);
    console.error('❌ error sql:', error.sql);       // ← query ที่พัง
    console.error('❌ error code:', error.code);     // ← เช่น ER_NO_REFERENCED_ROW
    return res.status(500).json({
      message: 'Internal server error',
      error: error.message,
      code: error.code
    });
  }
});

app.post("/create-asset-note", async (req, res) => {
  let connection; // ← เปลี่ยนเป็น let และไม่ assign ทันที

  try {
    connection = await db.getConnection(); // ← assign ใน try block
    await connection.beginTransaction();

    const {
      projectId,
      noteType,
      typeId,
      subject,
      body,
      fileUrl,
      fileIds,
      author,
      status,
      visibility,
      tasks,
      assignedPeople,
    } = req.body;

    console.log("📥 Received data:", req.body); // ← เพิ่ม log

    // Validation
    if (
      !projectId ||
      !noteType ||
      !typeId ||
      !subject ||
      !body ||
      !visibility ||
      !author
    ) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        message: "Missing required fields",
        received: {
          projectId,
          noteType,
          typeId,
          subject,
          body,
          visibility,
          author,
        },
      });
    }

    // ⭐ เพิ่ม sanitize function
    const sanitize = (value) => (value === undefined ? null : value);

    const safeStatus = status || "open";
    const safeTasks = tasks && tasks.length > 0 ? JSON.stringify(tasks) : null;
    const safeFileUrl = sanitize(fileUrl);

    console.log("📝 Inserting note with values:", {
      projectId,
      noteType,
      typeId,
      subject,
      body,
      fileUrl: safeFileUrl,
      author,
      safeStatus,
      visibility,
      safeTasks,
    }); // ← เพิ่ม log

    // 1. Insert note
    const [result] = await connection.execute(
      `INSERT INTO notes 
       (project_id, note_type, type_id, subject, body, file_url, author, status, visibility, tasks, read_status, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        sanitize(projectId),
        sanitize(noteType),
        sanitize(typeId),
        sanitize(subject),
        sanitize(body),
        safeFileUrl, // ← ใช้ safeFileUrl
        sanitize(author),
        sanitize(safeStatus),
        sanitize(visibility),
        safeTasks,
        "unread",
      ],
    );

    const noteId = result.insertId;
    console.log("✅ Note inserted with ID:", noteId); // ← เพิ่ม log

    // 2. Insert assignments
    if (assignedPeople && assignedPeople.length > 0) {
      const assignmentValues = assignedPeople.map((peopleId) => [
        noteId,
        peopleId,
      ]);

      console.log("👥 Inserting assignments:", assignmentValues); // ← เพิ่ม log

      await connection.query(
        `INSERT INTO note_assignments (note_id, people_id) VALUES ?`,
        [assignmentValues],
      );

        if (fileIds && fileIds.length > 0) {
      await connection.query(
        `UPDATE files_asset
        SET note_id = ? 
        WHERE id IN (?)`,
        [noteId, fileIds]
      );
      }
    }

    await connection.commit();
    console.log("✅ Transaction committed"); // ← เพิ่ม log

    res.status(201).json({
      message: "Note created successfully",
      noteId: noteId,
    });
  } catch (err) {
    console.error("❌ Create asset note error:", err); // ← ปรับ log

    if (connection) {
      await connection.rollback();
    }

    res.status(500).json({
      message: "Server error",
      error: err.message,
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined, // ← เพิ่ม stack trace
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

app.post("/create-shot-note", async (req, res) => {
  let connection; // ← เปลี่ยนเป็น let และไม่ assign ทันที

  try {
    connection = await db.getConnection(); // ← assign ใน try block
    await connection.beginTransaction();

    const {
      projectId,
      noteType,
      typeId,
      subject,
      body,
      fileUrl,
      fileIds,
      author,
      status,
      visibility,
      tasks,
      assignedPeople,
    } = req.body;

    console.log("📥 Received data:", req.body); // ← เพิ่ม log

    // Validation
    if (
      !projectId ||
      !noteType ||
      !typeId ||
      !subject ||
      !body ||
      !visibility ||
      !author
    ) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        message: "Missing required fields",
        received: {
          projectId,
          noteType,
          typeId,
          subject,
          body,
          visibility,
          author,
        },
      });
    }

    // ⭐ เพิ่ม sanitize function
    const sanitize = (value) => (value === undefined ? null : value);

    const safeStatus = status || "open";
    const safeTasks = tasks && tasks.length > 0 ? JSON.stringify(tasks) : null;
    const safeFileUrl = sanitize(fileUrl);

    console.log("📝 Inserting note with values:", {
      projectId,
      noteType,
      typeId,
      subject,
      body,
      fileUrl: safeFileUrl,
      author,
      safeStatus,
      visibility,
      safeTasks,
    }); // ← เพิ่ม log

    // 1. Insert note
    const [result] = await connection.execute(
      `INSERT INTO notes 
       (project_id, note_type, type_id, subject, body, file_url, author, status, visibility, tasks, read_status, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        sanitize(projectId),
        sanitize(noteType),
        sanitize(typeId),
        sanitize(subject),
        sanitize(body),
        safeFileUrl, // ← ใช้ safeFileUrl
        sanitize(author),
        sanitize(safeStatus),
        sanitize(visibility),
        safeTasks,
        "unread",
      ],
    );

    const noteId = result.insertId;
    console.log("✅ Note inserted with ID:", noteId); // ← เพิ่ม log

    // 2. Insert assignments
    if (assignedPeople && assignedPeople.length > 0) {
      const assignmentValues = assignedPeople.map((peopleId) => [
        noteId,
        peopleId,
      ]);

      console.log("👥 Inserting assignments:", assignmentValues); // ← เพิ่ม log

      await connection.query(
        `INSERT INTO note_assignments (note_id, people_id) VALUES ?`,
        [assignmentValues],
      );

      if (fileIds && fileIds.length > 0) {
      await connection.query(
        `UPDATE files_shot 
        SET note_id = ? 
        WHERE id IN (?)`,
        [noteId, fileIds]
      );
}

    }

    await connection.commit();
    console.log("✅ Transaction committed"); // ← เพิ่ม log

    res.status(201).json({
      message: "Note created successfully",
      noteId: noteId,
    });
  } catch (err) {
    console.error("❌ Create asset note error:", err); // ← ปรับ log

    if (connection) {
      await connection.rollback();
    }

    res.status(500).json({
      message: "Server error",
      error: err.message,
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined, // ← เพิ่ม stack trace
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

app.post("/create-sequence-note", async (req, res) => {
  let connection; // ← เปลี่ยนเป็น let และไม่ assign ทันที

  try {
    connection = await db.getConnection(); // ← assign ใน try block
    await connection.beginTransaction();

    const {
      projectId,
      noteType,
      typeId,
      subject,
      body,
      fileUrl,
      fileIds,
      author,
      status,
      visibility,
      tasks,
      assignedPeople,
    } = req.body;

    console.log("📥 Received data:", req.body); // ← เพิ่ม log

    // Validation
    if (
      !projectId ||
      !noteType ||
      !typeId ||
      !subject ||
      !body ||
      !visibility ||
      !author
    ) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        message: "Missing required fields",
        received: {
          projectId,
          noteType,
          typeId,
          subject,
          body,
          visibility,
          author,
        },
      });
    }

    // ⭐ เพิ่ม sanitize function
    const sanitize = (value) => (value === undefined ? null : value);

    const safeStatus = status || "open";
    const safeTasks = tasks && tasks.length > 0 ? JSON.stringify(tasks) : null;
    const safeFileUrl = sanitize(fileUrl);

    console.log("📝 Inserting note with values:", {
      projectId,
      noteType,
      typeId,
      subject,
      body,
      fileUrl: safeFileUrl,
      author,
      safeStatus,
      visibility,
      safeTasks,
    }); // ← เพิ่ม log

    // 1. Insert note
    const [result] = await connection.execute(
      `INSERT INTO notes 
       (project_id, note_type, type_id, subject, body, file_url, author, status, visibility, tasks, read_status, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        sanitize(projectId),
        sanitize(noteType),
        sanitize(typeId),
        sanitize(subject),
        sanitize(body),
        safeFileUrl, // ← ใช้ safeFileUrl
        sanitize(author),
        sanitize(safeStatus),
        sanitize(visibility),
        safeTasks,
        "unread",
      ],
    );

    const noteId = result.insertId;
    console.log("✅ Note inserted with ID:", noteId); // ← เพิ่ม log

    // 2. Insert assignments
    if (assignedPeople && assignedPeople.length > 0) {
      const assignmentValues = assignedPeople.map((peopleId) => [
        noteId,
        peopleId,
      ]);

      console.log("👥 Inserting assignments:", assignmentValues); // ← เพิ่ม log

      await connection.query(
        `INSERT INTO note_assignments (note_id, people_id) VALUES ?`,
        [assignmentValues],
      );

      if (fileIds && fileIds.length > 0) {
      await connection.query(
        `UPDATE files_sequence
        SET note_id = ? 
        WHERE id IN (?)`,
        [noteId, fileIds]
      );
      }
    }

    await connection.commit();
    console.log("✅ Transaction committed"); // ← เพิ่ม log

    res.status(201).json({
      message: "Note created successfully",
      noteId: noteId,
    });
  } catch (err) {
    console.error("❌ Create asset note error:", err); // ← ปรับ log

    if (connection) {
      await connection.rollback();
    }

    res.status(500).json({
      message: "Server error",
      error: err.message,
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined, // ← เพิ่ม stack trace
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

app.delete("/delete-note/:noteId", async (req, res) => {
  const { noteId } = req.params;

  if (!noteId) {
    return res.status(400).json({ message: "Missing noteId" });
  }

  let connection;

  try {
    // 🔹 ใช้ transaction เพื่อความปลอดภัย
    connection = await db.getConnection();
    await connection.beginTransaction();

    // 1️⃣ ดึงข้อมูล note รอบเดียว (สำคัญมาก)
    const [notes] = await connection.execute(
      "SELECT file_url, note_type, type_id FROM notes WHERE id = ?",
      [noteId]
    );

    if (notes.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Note not found" });
    }

    const { file_url: fileUrl, note_type: noteType, type_id } = notes[0];
    let fileDeleted = false;

    // 2️⃣ ลบไฟล์จริงใน storage (ไม่เกี่ยวกับ transaction)
    if (fileUrl) {
      try {
        let pathname = fileUrl;

        if (fileUrl.startsWith("http")) {
          pathname = new URL(fileUrl).pathname;
        }

        const relativePath = pathname.replace(/^\/?uploads\//, "");
        const fullPath = path.join(STORAGE_BASE, relativePath);

        console.log("🗑️ Deleting file:", fullPath);

        fileDeleted = deleteFile(fullPath);

        if (fileDeleted) {
          console.log("✅ File deleted");
        } else {
          console.warn("⚠️ File not found:", fullPath);
        }
      } catch (err) {
        console.warn("❌ File delete error:", err.message);
      }
    }

    if (noteType === "asset") {
      await connection.execute(
        "DELETE FROM files_asset WHERE note_id = ? AND type = 'note'",
        [noteId]
      );
    } else if (noteType === "shot") {
      await connection.execute(
        "DELETE FROM files_shot WHERE note_id = ? AND type = 'note'",
        [noteId]
      );
    } else if (noteType === "sequence") {
      await connection.execute(
        "DELETE FROM files_sequence WHERE note_id = ? AND type = 'note'",
        [noteId]
      );
    }

    // 4️⃣ ลบ assignments
    await connection.execute(
      "DELETE FROM note_assignments WHERE note_id = ?",
      [noteId]
    );

    // 5️⃣ ลบ note หลัก
    await connection.execute(
      "DELETE FROM notes WHERE id = ?",
      [noteId]
    );

    // ✅ commit
    await connection.commit();

    res.json({
      message: "Note deleted successfully",
      noteId,
      noteType,
      fileDeleted,
      fileUrl: fileUrl || null
    });

  } catch (err) {
    if (connection) await connection.rollback();

    console.error("❌ DELETE NOTE ERROR:", err);
    res.status(500).json({
      message: "Delete note failed",
      error: err.message
    });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/add-task", async (req, res) => {
  try {
    const {
      project_id,
      task_name,
      entity_type,
      entity_id,
      status,
      start_date,
      due_date,
      description,
      pipeline_step_id,
    } = req.body;

    // Validation
    if (!project_id) {
      return res.status(400).json({ message: "project_id is required" });
    }

    // เพิ่มหลัง validate task_name
    if (!entity_type || !entity_id) {
      return res.status(400).json({ message: "กรุณาเลือก Entity" });
    }

    if (!task_name || task_name.trim() === "") {
      return res.status(400).json({ message: "task_name is required" });
    }

    // ตั้งค่า status เริ่มต้นเป็น 'wtg' ถ้าไม่ได้ระบุ
    const taskStatus = status || "wtg";

    // ตรวจสอบว่า status ถูกต้องหรือไม่
    const validStatuses = ["wtg", "ip", "fin"];
    if (!validStatuses.includes(taskStatus)) {
      return res.status(400).json({
        message: "Invalid status. Must be 'wtg', 'ip', or 'fin'",
      });
    }

    // Insert task
    const [result] = await db.execute(
      `INSERT INTO tasks (
        project_id,
        task_name,
        entity_type,
        entity_id,
        status,
        start_date,
        due_date,
        description,
        pipeline_step_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        project_id,
        task_name.trim(),
        entity_type || null,
        entity_id || null,
        taskStatus,
        start_date || null,
        due_date || null,
        description || null,
        pipeline_step_id || null,
      ],
    );

    // ดึงข้อมูล task ที่เพิ่งสร้างกลับมา
    const [newTask] = await db.execute(
      `SELECT 
        t.*,
        CASE
          WHEN t.entity_type = 'asset' THEN a.asset_name
          WHEN t.entity_type = 'shot' THEN s.shot_name
          WHEN t.entity_type = 'sequence' THEN seq.sequence_name
          WHEN t.entity_type IS NULL THEN 'Unassigned'
          ELSE 'Unknown'
        END AS entity_name,
        ps.id AS pipeline_step_id,
        ps.step_name AS pipeline_step_name,
        ps.step_code AS pipeline_step_code,
        ps.color_hex AS pipeline_step_color
      FROM tasks t
      LEFT JOIN project_assets a ON a.id = t.entity_id AND t.entity_type = 'asset'
      LEFT JOIN project_shots s ON s.id = t.entity_id AND t.entity_type = 'shot'
      LEFT JOIN project_sequences seq ON seq.id = t.entity_id AND t.entity_type = 'sequence'
      LEFT JOIN pipeline_steps ps ON ps.id = t.pipeline_step_id
      WHERE t.id = ?`,
      [result.insertId],
    );

    const task = newTask[0];

    // แปลง pipeline_step เป็น object
    const taskWithDetails = {
      ...task,
      assignees: [],
      reviewers: [],
      pipeline_step: task.pipeline_step_id
        ? {
          id: task.pipeline_step_id,
          step_name: task.pipeline_step_name,
          step_code: task.pipeline_step_code,
          color_hex: task.pipeline_step_color,
        }
        : null,
    };

    res.status(201).json({
      message: "Task created successfully",
      task: taskWithDetails,
    });
  } catch (err) {
    console.error("Add task error:", err);
    res.status(500).json({
      message: "Server error",
      error: err.message,
    });
  }
});

app.post('/assets/create-for-shot', async (req, res) => {
  const { project_id, shot_id, asset_name, description, asset_type } = req.body;

  if (!project_id || !shot_id || !asset_name?.trim()) {
    return res.status(400).json({
      success: false,
      message: 'project_id, shot_id และ asset_name จำเป็นต้องมี'
    });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [assetResult] = await conn.execute(
      `INSERT INTO project_assets 
            (project_id, asset_name, description, type, status, created_at)
            VALUES (?, ?, ?, ?, 'wtg', NOW())`,
      [project_id, asset_name.trim(), description || null, asset_type || null]
    );

    const newAssetId = assetResult.insertId;

    // 2️⃣ เชื่อม asset กับ shot อัตโนมัติผ่าน asset_shots
    await conn.execute(
      `INSERT INTO asset_shots (asset_id, shot_id)
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE asset_id = asset_id`,
      [newAssetId, shot_id]
    );

    await conn.commit();

    res.json({
      success: true,
      message: 'สร้าง Asset และเชื่อม Shot สำเร็จ',
      data: { asset_id: newAssetId, asset_name: asset_name.trim(), shot_id }
    });

  } catch (err) {
    await conn.rollback();
    console.error('Create asset error:', err);
    res.status(500).json({
      success: false,
      message: 'ไม่สามารถสร้าง Asset ได้',
      error: err.message
    });
  } finally {
    conn.release();
  }
});

// +++++++++++++++++++++++++ -tasks +++++++++++++++++++++++++ //
app.post("/my-tasks", async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    const [rows] = await db.execute(
      `
      SELECT
        t.*,
        GROUP_CONCAT(
          DISTINCT CASE
            WHEN u_assign.id IS NOT NULL THEN JSON_OBJECT(
              'id', u_assign.id,
              'username', u_assign.name
            )
          END
        ) AS assignees,
        GROUP_CONCAT(
          DISTINCT CASE
            WHEN u_review.id IS NOT NULL THEN JSON_OBJECT(
              'id', u_review.id,
              'username', u_review.name
            )
          END
        ) AS reviewers
      FROM task_assignments ta
      INNER JOIN tasks t ON t.id = ta.task_id
      LEFT JOIN task_assignments ta2 ON ta2.task_id = t.id
      LEFT JOIN people u_assign ON u_assign.id = ta2.user_id
      LEFT JOIN task_reviewers tr ON tr.task_id = t.id
      LEFT JOIN people u_review ON u_review.id = tr.user_id
      WHERE ta.task_id IN (
        SELECT task_id
        FROM task_assignments
        WHERE user_id = ?
      )
      GROUP BY t.id
      ORDER BY t.start_date ASC
      `,
      [userId],
    );

    // แปลง assignees และ reviewers จาก string → array
    const result = rows.map((task) => ({
      ...task,
      assignees: task.assignees ? JSON.parse(`[${task.assignees}]`) : [],
      reviewers: task.reviewers ? JSON.parse(`[${task.reviewers}]`) : [],
    }));

    res.json(result);
  } catch (err) {
    console.error("Get my tasks error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/project-tasks-grouped", async (req, res) => {
  try {
    const { projectId } = req.body;
    if (!projectId) {
      return res.status(400).json({ message: "projectId is required" });
    }

    const [rows] = await db.execute(
      `
      SELECT
        t.*,
        CASE
          WHEN t.entity_type = 'asset' THEN a.asset_name
          WHEN t.entity_type = 'shot' THEN s.shot_name
          WHEN t.entity_type = 'sequence' THEN seq.sequence_name
          WHEN t.entity_type IS NULL THEN 'Unassigned'
          ELSE 'Unknown'
        END AS entity_name,
        ps.id AS pipeline_step_id,
        ps.step_name AS pipeline_step_name,
        ps.step_code AS pipeline_step_code,
        ps.color_hex AS pipeline_step_color,
        GROUP_CONCAT(
          DISTINCT CASE
            WHEN p_assign.id IS NOT NULL THEN JSON_OBJECT(
              'id', p_assign.id,
              'username', p_assign.name
            )
          END
        ) AS assignees,
        GROUP_CONCAT(
          DISTINCT CASE
            WHEN p_review.id IS NOT NULL THEN JSON_OBJECT(
              'id', p_review.id,
              'username', p_review.name
            )
          END
        ) AS reviewers
      FROM tasks t
      LEFT JOIN project_assets a ON a.id = t.entity_id AND t.entity_type = 'asset'
      LEFT JOIN project_shots s ON s.id = t.entity_id AND t.entity_type = 'shot'
      LEFT JOIN project_sequences seq ON seq.id = t.entity_id AND t.entity_type = 'sequence'
      LEFT JOIN pipeline_steps ps ON ps.id = t.pipeline_step_id
      LEFT JOIN task_assignments ta ON ta.task_id = t.id
      LEFT JOIN people p_assign ON p_assign.id = ta.user_id
      LEFT JOIN task_reviewers tr ON tr.task_id = t.id
      LEFT JOIN people p_review ON p_review.id = tr.user_id
      WHERE t.project_id = ?
      GROUP BY t.id, entity_name, ps.id, ps.step_name, ps.step_code, ps.color_hex
      ORDER BY 
        CASE WHEN t.entity_type IS NULL THEN 1 ELSE 0 END,
        entity_name ASC, 
        t.start_date ASC
      `,
      [projectId],
    );

    // แปลง assignees และ reviewers จาก string → array + เพิ่ม pipeline_step object
    const tasksWithDetails = rows.map((task) => ({
      ...task,
      assignees: task.assignees ? JSON.parse(`[${task.assignees}]`) : [],
      reviewers: task.reviewers ? JSON.parse(`[${task.reviewers}]`) : [],
      pipeline_step: task.pipeline_step_id
        ? {
          id: task.pipeline_step_id,
          step_name: task.pipeline_step_name,
          step_code: task.pipeline_step_code,
          color_hex: task.pipeline_step_color,
        }
        : null,
    }));

    // จัดกลุ่มตาม entity
    const grouped = tasksWithDetails.reduce((acc, task) => {
      const key =
        task.entity_type && task.entity_id
          ? `${task.entity_type}_${task.entity_id}`
          : "unassigned_0";

      if (!acc[key]) {
        acc[key] = {
          entity_id: task.entity_id || 0,
          entity_type: task.entity_type || "unassigned",
          entity_name: task.entity_name || "Unassigned Tasks",
          tasks: [],
        };
      }
      acc[key].tasks.push(task);
      return acc;
    }, {});

    res.json(Object.values(grouped));
  } catch (err) {
    console.error("Get project tasks grouped error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// GET Pipeline Steps by Entity Type 
app.post("/pipeline-steps", async (req, res) => {
  try {
    const { entityType } = req.body;

    if (!entityType) {
      return res.status(400).json({ message: "entityType is required" });
    }

    const [steps] = await db.execute(
      `SELECT * FROM pipeline_steps 
       WHERE entity_type = ? AND is_active = TRUE 
       ORDER BY display_order ASC`,
      [entityType],
    );

    res.json(steps);
  } catch (err) {
    console.error("Get pipeline steps error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// Backend API (ไม่ต้องแก้)
app.post("/updatetask", async (req, res) => {
  try {
    const { taskId, field, value } = req.body;

    const allowedFields = [
      "task_name",
      "status",
      "start_date",
      "due_date",
      "description",
      "pipeline_step_id",
    ];

    if (!taskId || !allowedFields.includes(field)) {
      return res.status(400).json({ message: "Invalid request" });
    }

    // ✅ แปลง empty string เป็น null สำหรับ date fields
    let finalValue = value;
    if ((field === "start_date" || field === "due_date") && value === "") {
      finalValue = null;
    }

    await db.execute(`UPDATE tasks SET ${field} = ? WHERE id = ?`, [
      finalValue,
      Number(taskId),
    ]);

    res.json({ message: "Task updated successfully" });
  } catch (err) {
    console.error("Update task error:", err);
    res.status(500).json({ message: err.message });
  }
});

// ++++++++++++++++++++++++++++++++++ shot - task
app.post("/shot-task", async (req, res) => {
  const { project_id, entity_type, entity_id } = req.body;

  if (!project_id || !entity_type || !entity_id) {
    return res.status(400).json({
      message: "project_id, entity_type, entity_id are required",
    });
  }

  const [tasks] = await db.execute(
    ` 
    SELECT 
      t.id, 
      t.project_id, 
      t.entity_type, 
      t.entity_id, 
      t.task_name, 
      t.status, 
      t.start_date, 
      t.due_date, 
      t.created_at, 
      t.description, 
      ps.id AS pipeline_step_id,
      ps.step_name AS pipeline_step_name,
      ps.step_code AS pipeline_step_code,
      ps.color_hex AS pipeline_step_color,
      GROUP_CONCAT( 
        DISTINCT CASE
          WHEN p_assign.id IS NOT NULL THEN JSON_OBJECT(
            'id', p_assign.id, 
            'username', p_assign.name
          )
        END
      ) AS assignees,
      GROUP_CONCAT(
        DISTINCT CASE
          WHEN p_review.id IS NOT NULL THEN JSON_OBJECT(
            'id', p_review.id,
            'username', p_review.name
          )
        END
      ) AS reviewers
    FROM tasks t 
    LEFT JOIN task_assignments ta ON t.id = ta.task_id 
    LEFT JOIN people p_assign ON p_assign.id = ta.user_id
    LEFT JOIN task_reviewers tr ON tr.task_id = t.id
    LEFT JOIN people p_review ON p_review.id = tr.user_id
    LEFT JOIN pipeline_steps ps ON ps.id = t.pipeline_step_id
    WHERE t.project_id = ? 
      AND t.entity_type = ? 
      AND t.entity_id = ? 
    GROUP BY t.id, ps.id, ps.step_name, ps.step_code, ps.color_hex
    ORDER BY t.created_at 
    `,
    [project_id, entity_type, entity_id],
  );

  const result = tasks.map((task) => ({
    ...task,
    assignees: task.assignees ? JSON.parse(`[${task.assignees}]`) : [],
    reviewers: task.reviewers ? JSON.parse(`[${task.reviewers}]`) : [],
    pipeline_step: task.pipeline_step_id
      ? {
        id: task.pipeline_step_id,
        step_name: task.pipeline_step_name,
        step_code: task.pipeline_step_code,
        color_hex: task.pipeline_step_color,
      }
      : null,
  }));

  res.json(result);
});

// sequence-task
app.post("/sequence-task", async (req, res) => {
  const { project_id, entity_type, entity_id } = req.body;
  console.log("📥 Request:", { project_id, entity_type, entity_id });

  if (!project_id || !entity_type || !entity_id) {
    return res.status(400).json({
      message: "project_id, entity_type, entity_id are required",
    });
  }

  const [tasks] = await db.execute(
    ` 
    SELECT 
      t.id, 
      t.project_id, 
      t.entity_type, 
      t.entity_id, 
      t.task_name, 
      t.status, 
      t.start_date, 
      t.due_date, 
      t.created_at, 
      t.description, 
      ps.id AS pipeline_step_id,
      ps.step_name AS pipeline_step_name,
      ps.step_code AS pipeline_step_code,
      ps.color_hex AS pipeline_step_color,
      GROUP_CONCAT( 
        DISTINCT CASE
          WHEN p_assign.id IS NOT NULL THEN JSON_OBJECT(
            'id', p_assign.id, 
            'username', p_assign.name
          )
        END
      ) AS assignees,
      GROUP_CONCAT(
        DISTINCT CASE
          WHEN p_review.id IS NOT NULL THEN JSON_OBJECT(
            'id', p_review.id,
            'username', p_review.name
          )
        END
      ) AS reviewers
    FROM tasks t 
    LEFT JOIN task_assignments ta ON t.id = ta.task_id 
    LEFT JOIN people p_assign ON p_assign.id = ta.user_id
    LEFT JOIN task_reviewers tr ON tr.task_id = t.id
    LEFT JOIN people p_review ON p_review.id = tr.user_id
    LEFT JOIN pipeline_steps ps ON ps.id = t.pipeline_step_id
    WHERE t.project_id = ? 
      AND t.entity_type = ? 
      AND t.entity_id = ? 
    GROUP BY t.id, ps.id, ps.step_name, ps.step_code, ps.color_hex
    ORDER BY t.created_at 
    `,
    [project_id, entity_type, entity_id],
  );

  const result = tasks.map((task) => ({
    ...task,
    assignees: task.assignees ? JSON.parse(`[${task.assignees}]`) : [],
    reviewers: task.reviewers ? JSON.parse(`[${task.reviewers}]`) : [],
    pipeline_step: task.pipeline_step_id
      ? {
        id: task.pipeline_step_id,
        step_name: task.pipeline_step_name,
        step_code: task.pipeline_step_code,
        color_hex: task.pipeline_step_color,
      }
      : null,
  }));

  console.log("📤 Found tasks:", result.length);
  res.json(result);
});

// asset-task
app.post("/asset-task", async (req, res) => {
  const { project_id, entity_type, entity_id } = req.body;
  console.log("📥 Request:", { project_id, entity_type, entity_id });

  if (!project_id || !entity_type || !entity_id) {
    return res.status(400).json({
      message: "project_id, entity_type, entity_id are required",
    });
  }

  const [tasks] = await db.execute(
    ` 
    SELECT 
      t.id, 
      t.project_id, 
      t.entity_type, 
      t.entity_id, 
      t.task_name, 
      t.status, 
      t.start_date, 
      t.due_date, 
      t.created_at, 
      t.description, 
      ps.id AS pipeline_step_id,
      ps.step_name AS pipeline_step_name,
      ps.step_code AS pipeline_step_code,
      ps.color_hex AS pipeline_step_color,
      GROUP_CONCAT( 
        DISTINCT CASE
          WHEN p_assign.id IS NOT NULL THEN JSON_OBJECT(
            'id', p_assign.id, 
            'username', p_assign.name
          )
        END
      ) AS assignees,
      GROUP_CONCAT(
        DISTINCT CASE
          WHEN p_review.id IS NOT NULL THEN JSON_OBJECT(
            'id', p_review.id,
            'username', p_review.name
          )
        END
      ) AS reviewers
    FROM tasks t 
    LEFT JOIN task_assignments ta ON t.id = ta.task_id 
    LEFT JOIN people p_assign ON p_assign.id = ta.user_id
    LEFT JOIN task_reviewers tr ON tr.task_id = t.id
    LEFT JOIN people p_review ON p_review.id = tr.user_id
    LEFT JOIN pipeline_steps ps ON ps.id = t.pipeline_step_id
    WHERE t.project_id = ? 
      AND t.entity_type = ? 
      AND t.entity_id = ? 
    GROUP BY t.id, ps.id, ps.step_name, ps.step_code, ps.color_hex
    ORDER BY t.created_at 
    `,
    [project_id, entity_type, entity_id],
  );

  const result = tasks.map((task) => ({
    ...task,
    assignees: task.assignees ? JSON.parse(`[${task.assignees}]`) : [],
    reviewers: task.reviewers ? JSON.parse(`[${task.reviewers}]`) : [],
    pipeline_step: task.pipeline_step_id
      ? {
        id: task.pipeline_step_id,
        step_name: task.pipeline_step_name,
        step_code: task.pipeline_step_code,
        color_hex: task.pipeline_step_color,
      }
      : null,
  }));

  console.log("📤 Found tasks:", result.length);
  res.json(result);
});

// API: เพิ่ม Assignee
app.post("/add-task-assignee", async (req, res) => {
  try {
    const { taskId, userId } = req.body;

    if (!taskId || !userId) {
      return res
        .status(400)
        .json({ message: "taskId and userId are required" });
    }

    // เช็คว่ามีอยู่แล้วหรือไม่
    const [existing] = await db.execute(
      "SELECT * FROM task_assignments WHERE task_id = ? AND user_id = ?",
      [taskId, userId],
    );

    if (existing.length > 0) {
      return res.status(400).json({ message: "User already assigned" });
    }

    await db.execute(
      "INSERT INTO task_assignments (task_id, user_id) VALUES (?, ?)",
      [taskId, userId],
    );

    // ⭐ แก้ตรงนี้ - ดึงจาก people แทน users
    const [user] = await db.execute(
      "SELECT id, name as username FROM people WHERE id = ?",
      [userId],
    );

    res.json({
      message: "Assignee added successfully",
      user: user[0],
    });
  } catch (err) {
    console.error("Add assignee error:", err);
    res.status(500).json({ message: err.message });
  }
});

// API: ลบ Assignee (ไม่ต้องแก้)
app.post("/remove-task-assignee", async (req, res) => {
  try {
    const { taskId, userId } = req.body;

    if (!taskId || !userId) {
      return res
        .status(400)
        .json({ message: "taskId and userId are required" });
    }

    await db.execute(
      "DELETE FROM task_assignments WHERE task_id = ? AND user_id = ?",
      [taskId, userId],
    );

    res.json({ message: "Assignee removed successfully" });
  } catch (err) {
    console.error("Remove assignee error:", err);
    res.status(500).json({ message: err.message });
  }
});

// API: เพิ่ม Reviewer
app.post("/add-task-reviewer", async (req, res) => {
  try {
    const { taskId, userId } = req.body;

    if (!taskId || !userId) {
      return res
        .status(400)
        .json({ message: "taskId and userId are required" });
    }

    // เช็คว่ามีอยู่แล้วหรือไม่
    const [existing] = await db.execute(
      "SELECT * FROM task_reviewers WHERE task_id = ? AND user_id = ?",
      [taskId, userId],
    );

    if (existing.length > 0) {
      return res
        .status(400)
        .json({ message: "User already assigned as reviewer" });
    }

    await db.execute(
      "INSERT INTO task_reviewers (task_id, user_id) VALUES (?, ?)",
      [taskId, userId],
    );

    // ⭐ แก้ตรงนี้ - ดึงจาก people แทน users
    const [user] = await db.execute(
      "SELECT id, name as username FROM people WHERE id = ?",
      [userId],
    );

    res.json({
      message: "Reviewer added successfully",
      user: user[0],
    });
  } catch (err) {
    console.error("Add reviewer error:", err);
    res.status(500).json({ message: err.message });
  }
});

// API: ลบ Reviewer 
app.post("/remove-task-reviewer", async (req, res) => {
  try {
    const { taskId, userId } = req.body;

    if (!taskId || !userId) {
      return res
        .status(400)
        .json({ message: "taskId and userId are required" });
    }

    await db.execute(
      "DELETE FROM task_reviewers WHERE task_id = ? AND user_id = ?",
      [taskId, userId],
    );

    res.json({ message: "Reviewer removed successfully" });
  } catch (err) {
    console.error("Remove reviewer error:", err);
    res.status(500).json({ message: err.message });
  }
});

// API: ดึงรายชื่อ Users ทั้งหมดในโปรเจค
app.post("/project-users", async (req, res) => {
  try {
    console.log("GET ALL ACTIVE USERS");

    const [users] = await db.execute(
      `SELECT id, name as username 
       FROM people 
       WHERE status = 'Active'
       ORDER BY name ASC`
    );

    console.log("Found active users:", users.length);

    res.json(users);
  } catch (err) {
    console.error("Get users error:", err);
    res.status(500).json({ message: err.message });
  }
});

app.post("/update-asset", async (req, res) => {
  try {
    const {
      assetId,
      field,
      value
    } = req.body;

    // Validation
    if (!assetId) {
      return res.status(400).json({
        success: false,
        message: "assetId is required",
      });
    }

    if (!field) {
      return res.status(400).json({
        success: false,
        message: "field is required",
      });
    }

    // กำหนด fields ที่อนุญาตให้อัปเดต
    const allowedFields = [
      'asset_name',
      'status',
      'description',
      'type',
      'order_index',
      'file_url',
      'taskTemplate',
      'sequence_id',
      'shot_id'
    ];

    if (!allowedFields.includes(field)) {
      return res.status(400).json({
        success: false,
        message: `Field '${field}' is not allowed to update`,
        allowedFields: allowedFields
      });
    }

    // ตรวจสอบว่า asset มีอยู่จริง
    const [existingAsset] = await db.execute(
      `SELECT id FROM project_assets WHERE id = ?`,
      [assetId]
    );

    if (existingAsset.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Asset not found",
      });
    }

    // Update ข้อมูล
    const query = `UPDATE project_assets SET ${field} = ? WHERE id = ?`;

    await db.execute(query, [value, assetId]);

    // ดึงข้อมูลที่อัปเดตแล้ว
    const [updatedAsset] = await db.execute(
      `SELECT * FROM project_assets WHERE id = ?`,
      [assetId]
    );

    return res.json({
      success: true,
      message: `${field} updated successfully`,
      data: updatedAsset[0]
    });

  } catch (error) {
    console.error("update-asset error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
});

app.post("/update-shot", async (req, res) => {
  try {
    const { shotId, field, value } = req.body;

    // ========================================
    // 1. VALIDATION
    // ========================================
    if (!shotId) {
      return res.status(400).json({
        success: false,
        message: "shotId is required",
      });
    }

    if (!field) {
      return res.status(400).json({
        success: false,
        message: "field is required",
      });
    }

    // ========================================
    // 2. ALLOWED FIELDS (ตามโครงสร้างตาราง)
    // ========================================
    const allowedFields = [
      'shot_name',      // ชื่อ shot
      'status',         // สถานะ (wtg, ip, fin)
      'description',    // คำอธิบาย
      'file_url',       // URL thumbnail/file
      'order_index',    // ลำดับการแสดงผล
      'sequence_id'     // เปลี่ยน sequence (ถ้าต้องการ)
    ];

    if (!allowedFields.includes(field)) {
      return res.status(400).json({
        success: false,
        message: `Field '${field}' is not allowed to update`,
        allowedFields: allowedFields
      });
    }

    // ========================================
    // 3. CHECK IF SHOT EXISTS
    // ========================================
    const [existingShot] = await db.execute(
      `SELECT id, project_id FROM project_shots WHERE id = ?`,
      [shotId]
    );

    if (existingShot.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Shot not found",
      });
    }

    // ========================================
    // 4. UPDATE DATA
    // ========================================
    const query = `UPDATE project_shots SET ${field} = ? WHERE id = ?`;

    await db.execute(query, [value, shotId]);

    // ========================================
    // 5. FETCH UPDATED DATA
    // ========================================
    const [updatedShot] = await db.execute(
      `SELECT 
        id as shot_id,
        project_id,
        sequence_id,
        shot_name,
        status as shot_status,
        description as shot_description,
        created_at as shot_created_at,
        order_index,
        file_url as shot_thumbnail
       FROM project_shots 
       WHERE id = ?`,
      [shotId]
    );

    return res.json({
      success: true,
      message: `${field} updated successfully`,
      data: updatedShot[0]
    });

  } catch (error) {
    console.error("❌ update-shot error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
});

app.post("/project-viewers", async (req, res) => {
  const { projectId } = req.body;

  if (!projectId) {
    return res.status(400).json({ message: "projectId is required" });
  }

  try {
    const [rows] = await db.query(
      `SELECT 
        pv.id,
        pv.user_id,
        pv.project_id,
        pv.added_at,
        u.username,
        u.email,
        u.imageURL
       FROM project_viewers pv
       JOIN users u ON u.id = pv.user_id
       WHERE pv.project_id = ?
       ORDER BY pv.added_at DESC`,
      [projectId]
    );

    return res.json(rows);
  } catch (err) {
    console.error("❌ GET project_viewers error:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

app.post("/project-viewers-add", async (req, res) => {
  const { projectId, userId } = req.body;

  if (!projectId || !userId) {
    return res.status(400).json({ message: "projectId and userId are required" });
  }

  try {
    // เช็คว่ามีอยู่แล้วหรือเปล่า
    const [existing] = await db.query(
      `SELECT id FROM project_viewers WHERE project_id = ? AND user_id = ?`,
      [projectId, userId]
    );

    if (existing.length > 0) {
      return res.status(409).json({ message: "User is already a viewer of this project" });
    }

    // เช็คว่า user มีอยู่จริง
    const [userCheck] = await db.query(
      `SELECT id, username, email FROM users WHERE id = ?`,
      [userId]
    );

    if (userCheck.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    // Insert
    const [result] = await db.query(
      `INSERT INTO project_viewers (project_id, user_id) VALUES (?, ?)`,
      [projectId, userId]
    );

    return res.status(201).json({
      message: "Viewer added successfully",
      id: result.insertId,
      projectId,
      userId,
      username: userCheck[0].username,
      email: userCheck[0].email,
    });
  } catch (err) {
    console.error("❌ ADD project_viewer error:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

app.delete("/project-viewers-remove", async (req, res) => {
  const { id } = req.body;

  if (!id) {
    return res.status(400).json({ message: "id is required" });
  }

  try {
    const [result] = await db.query(
      `DELETE FROM project_viewers WHERE id = ?`,
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Viewer record not found" });
    }

    return res.json({ message: "Viewer removed successfully" });
  } catch (err) {
    console.error("❌ DELETE project_viewer error:", err);
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

// POST /video-comments
app.post("/video-comments", async (req, res) => {
  const { version_id, author_id, text, video_time, annotations } = req.body;

  // video_time รับทั้ง number และ array
  const primaryTime = Array.isArray(video_time) ? video_time[0] : video_time;

  const [result] = await db.query(
    `INSERT INTO video_comments (version_id, author_id, text, video_time)
         VALUES (?, ?, ?, ?)`,
    [version_id, author_id, text, primaryTime]
  );

  const commentId = result.insertId;

  if (annotations?.length > 0) {
    const values = annotations.map(a => [
      commentId,
      JSON.stringify(a.path),
      a.color || '#FF0000',
      a.width || 3,
      a.timestamp  // ← แต่ละ annotation เก็บ timestamp ของตัวเอง
    ]);
    await db.query(
      `INSERT INTO video_annotations (comment_id, path_data, color, width, video_time)
             VALUES ?`,
      [values]
    );
  }

  res.json({ success: true, commentId });
});

// 2. POST /video-comments/list — ดึง comments ทั้งหมดของ version
app.post("/video-comments/list", async (req, res) => {
  try {
    const { version_id } = req.body;

    if (!version_id) {
      return res.status(400).json({ error: "version_id is required" });
    }

    const [comments] = await db.query(
      `SELECT 
                vc.id, vc.text, vc.video_time, vc.created_at,
                p.id AS author_id, p.name AS author_name
             FROM video_comments vc
             JOIN people p ON vc.author_id = p.id
             WHERE vc.version_id = ?
             ORDER BY vc.created_at DESC`,
      [version_id]
    );

    if (comments.length > 0) {
      const commentIds = comments.map(c => c.id);
      const [annotations] = await db.query(
        `SELECT comment_id, path_data, color, width, video_time
                 FROM video_annotations
                 WHERE comment_id IN (?)`,
        [commentIds]
      );

      const annotationMap = {};
      annotations.forEach(a => {
        if (!annotationMap[a.comment_id]) annotationMap[a.comment_id] = [];
        annotationMap[a.comment_id].push({
          path: typeof a.path_data === 'string' ? JSON.parse(a.path_data) : a.path_data,
          color: a.color,
          width: a.width,
          timestamp: a.video_time
        });
      });

      comments.forEach(c => { c.annotations = annotationMap[c.id] || []; });
    }

    res.json(comments);
  } catch (err) {
    console.error("Get comments error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/video-comments/update", async (req, res) => {
  const { comment_id, text, annotations } = req.body;

  if (!comment_id) return res.status(400).json({ error: "comment_id is required" });

  // 1. update text (ถ้าส่งมา)
  if (text !== undefined) {
    await db.query(
      `UPDATE video_comments SET text = ? WHERE id = ?`,
      [text, comment_id]
    );
  }

  // 2. replace annotations (ถ้าส่งมา)
  if (annotations !== undefined) {
    // ลบอันเก่าทิ้งก่อน แล้ว insert ใหม่
    await db.query(`DELETE FROM video_annotations WHERE comment_id = ?`, [comment_id]);

    if (annotations.length > 0) {
      const values = annotations.map(a => [
        comment_id,
        JSON.stringify(a.path),
        a.color || '#FF0000',
        a.width || 3,
        a.timestamp
      ]);
      await db.query(
        `INSERT INTO video_annotations (comment_id, path_data, color, width, video_time) VALUES ?`,
        [values]
      );
    }
  }

  res.json({ success: true });
});

app.post("/get-task-notes-rightpanel", async (req, res) => {
  try {
    const { taskId } = req.body;
    if (!taskId) return res.status(400).json({ message: "taskId is required" });

    const taskIdNum = Number(taskId);
    if (isNaN(taskIdNum)) return res.status(400).json({ message: "taskId must be a number" });

    const [notes] = await db.execute(
      `SELECT n.*, GROUP_CONCAT(DISTINCT p.name) as assigned_people
       FROM notes n
       LEFT JOIN note_assignments na ON n.id = na.note_id
       LEFT JOIN people p ON na.people_id = p.id
       WHERE n.tasks IS NOT NULL
         AND JSON_CONTAINS(n.tasks, ?, '$')
       GROUP BY n.id
       ORDER BY n.created_at DESC`,
      [String(taskIdNum)]   // ส่งเป็น "353" ไม่ใช่ '"353"' — MySQL จะ parse เป็น number ใน JSON context
    );

    const result = notes.map(note => ({
      ...note,
      tasks: (() => {
        try { return note.tasks ? JSON.parse(note.tasks) : []; }
        catch { return []; }
      })(),
      assigned_people: note.assigned_people
        ? note.assigned_people.split(",")
        : [],
    }));

    res.json(result);
  } catch (err) {
    console.error("get-task-notes-rightpanel error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

const SECRET_PASSWORD = process.env.SQL_CONSOLE_PASSWORD || "max";

// Verify secret password
app.post('/verify-secret', (req, res) => {
  const { password } = req.body;

  if (password === SECRET_PASSWORD) {
    const token = Buffer.from(`${Date.now()}-${Math.random()}`).toString('base64');

    res.json({
      success: true,
      token,
      message: "Access granted"
    });
  } else {
    res.status(401).json({
      success: false,
      message: "Invalid password"
    });
  }
});

// Execute SQL
app.post('/execute', async (req, res) => {
  const { method, table, query, token } = req.body;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    let finalQuery = '';

    switch (method) {
      case 'SELECT':
        finalQuery = query.trim() || `SELECT * FROM ${table} LIMIT 100`;
        break;
      case 'INSERT':
      case 'UPDATE':
      case 'DELETE':
      case 'CUSTOM':
        finalQuery = query.trim();
        break;
      default:
        return res.status(400).json({ error: "Invalid method" });
    }

    if (!finalQuery) {
      return res.status(400).json({ error: "Query is required" });
    }

    // 🔐 Hash password สำหรับ users table
    if (table === 'users' && (method === 'INSERT' || method === 'UPDATE')) {

      // ---------- UPDATE CASE ----------
      const updateRegex = /password\s*=\s*'([^']+)'/gi;
      const updateMatches = [...finalQuery.matchAll(updateRegex)];

      for (const match of updateMatches) {
        const plainPassword = match[1];

        if (
          plainPassword &&
          plainPassword !== 'NULL' &&
          plainPassword.trim() !== '' &&
          !plainPassword.startsWith('$2a$') &&
          !plainPassword.startsWith('$2b$')
        ) {
          const hashedPassword = await bcrypt.hash(plainPassword, 10);
          finalQuery = finalQuery.replace(match[0], `password = '${hashedPassword}'`);
          console.log('🔐 Password hashed (UPDATE)');
        }
      }

      // ---------- INSERT CASE ----------
      const insertRegex = /insert\s+into\s+users\s*\(([^)]+)\)\s*values\s*\(([^)]+)\)/i;
      const insertMatch = finalQuery.match(insertRegex);

      if (insertMatch) {
        const columns = insertMatch[1].split(',').map(c => c.trim());
        const values = insertMatch[2].split(',').map(v => v.trim());

        const passwordIndex = columns.findIndex(col => col.toLowerCase() === 'password');

        if (passwordIndex !== -1) {
          let plainPassword = values[passwordIndex].replace(/'/g, '');

          if (
            plainPassword &&
            !plainPassword.startsWith('$2a$') &&
            !plainPassword.startsWith('$2b$')
          ) {
            const hashedPassword = await bcrypt.hash(plainPassword, 10);
            values[passwordIndex] = `'${hashedPassword}'`;

            const newValues = values.join(', ');
            finalQuery = finalQuery.replace(insertMatch[2], newValues);

            console.log('🔐 Password hashed (INSERT)');
          }
        }
      }
    }


    console.log(`🔍 Executing: ${finalQuery}`);

    const results = await db.query(finalQuery);

    let dataArray = [];
    let rowCount = 0;

    if (Array.isArray(results)) {
      dataArray = results;
      rowCount = results.length;
    } else if (results.rows && Array.isArray(results.rows)) {
      dataArray = results.rows;
      rowCount = results.rows.length;
    } else if (results[0] && Array.isArray(results[0])) {
      dataArray = results[0];
      rowCount = results[0].length;
    } else {
      dataArray = [];
      rowCount = results.affectedRows || 0;
    }

    console.log(`✅ Query successful - ${rowCount} rows`);
    console.log(`📊 Data type: ${typeof dataArray}, isArray: ${Array.isArray(dataArray)}`);
    console.log(`📦 Sample data:`, dataArray[0]);

    res.json({
      success: true,
      method,
      query: finalQuery,
      data: dataArray,
      rowCount: rowCount,
      message: "Query executed successfully"
    });

  } catch (error) {
    console.error("❌ SQL Error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code
    });
  }
});

// Get all tables
app.post('/tables', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const result = await db.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = DATABASE()
            ORDER BY table_name
        `);

    res.json({
      success: true,
      tables: result.rows || result
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get query logs
app.post('/logs', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const logs = await db.query(
      `SELECT * FROM secret_logs 
             ORDER BY executed_at DESC 
             LIMIT 50`
    );

    res.json({
      success: true,
      logs: logs.rows || logs || []  // ⭐ เพิ่ม || []
    });
  } catch (error) {
    console.error("❌ Logs error:", error);

    // ⭐ ถ้า error (เช่น ตารางยังไม่มี) ให้ return empty array
    res.json({
      success: true,
      logs: []
    });
  }
});

// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++ //


// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++ //

/* ===== HEALTH CHECK ===== */
app.get("/", (req, res) => {
  res.send("✅ API is running");
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    storage: STORAGE_BASE,
  });
});

/* ===== START SERVER ===== */
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 API running on port ${PORT}`);
  console.log(`📁 Storage path: ${STORAGE_BASE}`);
});

22;
export default app;
