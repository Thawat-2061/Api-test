import "dotenv/config"; 
import express from "express";
import cors from "cors";
import bcrypt from "bcrypt";
import { supabase } from "./supabaseClient.js";

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ---------- REGISTER ---------- */
app.post("/register", async (req, res) => {
  try {
    const { username, email, password, role, avartarURL } = req.body;
    const finalAvatarURL = avartarURL;

    if (!username || !email || !password || !finalAvatarURL) {
      return res.status(400).json({
        error: "MISSING_FIELDS",
        message: "Username, email, password and avatar are required",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: "WEAK_PASSWORD",
        message: "Password must be at least 6 characters",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUsername = username.trim();

    const { data: existing, error: checkErr } = await supabase
      .from("users")
      .select("id")
      .or(`email.eq.${normalizedEmail},username.eq.${normalizedUsername}`)
      .maybeSingle();

    if (checkErr) throw checkErr;
    if (existing) {
      return res.status(409).json({
        error: "DUPLICATE_USER",
        message: "Email or username already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const { data: user, error: insertErr } = await supabase
      .from("users")
      .insert({
        username: normalizedUsername,
        email: normalizedEmail,
        password: hashedPassword,
        role: role || "Artist",
        avatar_url: finalAvatarURL,
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    console.log("✅ User registered:", user.id);

    res.status(201).json({
      message: "Registration successful",
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        avatarURL: user.avatar_url,
      },
    });
  } catch (err) {
    console.error("❌ REGISTER ERROR:", err);
    res.status(500).json({
      error: "SERVER_ERROR",
      message: "Registration failed",
    });
  }
});

/* ---------- LOGIN ---------- */
app.post("/login", async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({
        error: "MISSING_CREDENTIALS",
        message: "Email/Username and password required",
      });
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .or(`email.eq.${identifier.toLowerCase()},username.eq.${identifier}`)
      .maybeSingle();

    if (error) throw error;

    if (!user || !user.password) {
      return res.status(401).json({
        error: "INVALID_LOGIN",
        message: "Invalid email/username or password",
      });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({
        error: "INVALID_LOGIN",
        message: "Invalid email/username or password",
      });
    }

    res.json({
      message: "Login successful",
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        avatarURL: user.avatar_url,
      },
    });
  } catch (err) {
    console.error("❌ LOGIN ERROR:", err);
    res.status(500).json({
      error: "SERVER_ERROR",
      message: "Login failed",
    });
  }
});

/* ---------- GET USER ---------- */
app.post("/getuser", async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ 
      message: "Please provide user id",
      error: "MISSING_ID" 
    });

    const { data: user, error } = await supabase
      .from("users")
      .select("id, username, email, role, avatar_url, created_at")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.status(404).json({ 
          message: "User not found",
          error: "USER_NOT_FOUND" 
        });
      }
      throw error;
    }

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        avatarURL: user.avatar_url,
        createdAt: user.created_at,
      },
    });
  } catch (err) {
    console.error("❌ GET USER ERROR:", err);
    res.status(500).json({ 
      message: "Failed to fetch user",
      error: "SERVER_ERROR" 
    });
  }
});

/* ---------- SEARCH USER ---------- */
app.post("/searchuser", async (req, res) => {
  try {
    let { query } = req.body;
    if (!query) return res.status(400).json({ 
      message: "Please provide search query",
      error: "MISSING_QUERY" 
    });

    query = query.toLowerCase().trim();

    const { data: users, error } = await supabase
      .from("users")
      .select("id, username, email, avatar_url, role")
      .ilike("username", `%${query}%`)
      .limit(10);

    if (error) throw error;

    const results = users.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      avatarURL: u.avatar_url,
      role: u.role,
    }));

    res.json({ results });
  } catch (err) {
    console.error("❌ SEARCH USER ERROR:", err);
    res.status(500).json({ 
      message: "Search failed",
      error: "SERVER_ERROR" 
    });
  }
});

/* ---------- ADD FRIEND ---------- */
app.put("/addfriend", async (req, res) => {
  try {
    const { uid, friendUid } = req.body;

    if (!uid || !friendUid) {
      return res.status(400).json({ 
        message: "Please provide uid and friendUid",
        error: "MISSING_FIELDS" 
      });
    }

    if (uid === friendUid) {
      return res.status(400).json({ 
        message: "Cannot add yourself as a friend",
        error: "SELF_ADD" 
      });
    }

    const { data: friendExists, error: friendCheckError } = await supabase
      .from("users")
      .select("id")
      .eq("id", friendUid)
      .maybeSingle();

    if (friendCheckError) throw friendCheckError;
    if (!friendExists) {
      return res.status(404).json({ 
        message: "Friend user not found",
        error: "FRIEND_NOT_FOUND" 
      });
    }

    const { data: existing, error: fetchError } = await supabase
      .from("friends")
      .select("friends_list")
      .eq("uid", uid)
      .maybeSingle();

    if (fetchError && fetchError.code !== "PGRST116") throw fetchError;

    let friendsList = existing?.friends_list || [];

    if (friendsList.includes(friendUid)) {
      return res.status(400).json({ 
        message: "Friend already added",
        error: "ALREADY_FRIENDS" 
      });
    }

    friendsList.push(friendUid);

    const { error: upsertError } = await supabase
      .from("friends")
      .upsert({ uid, friends_list: friendsList }, { onConflict: "uid" });

    if (upsertError) throw upsertError;

    console.log("✅ Friend added:", uid, "->", friendUid);

    res.json({ message: "Friend added successfully", friendsList });
  } catch (err) {
    console.error("❌ ADD FRIEND ERROR:", err);
    res.status(500).json({ 
      message: "Failed to add friend",
      error: "SERVER_ERROR" 
    });
  }
});

/* ---------- GET FRIENDS ---------- */
app.post("/getfriends", async (req, res) => {
  try {
    const { uid } = req.body;
    if (!uid) return res.status(400).json({ 
      message: "Please provide uid",
      error: "MISSING_UID" 
    });

    const { data: friendsData, error: fetchError } = await supabase
      .from("friends")
      .select("friends_list")
      .eq("uid", uid)
      .maybeSingle();

    if (fetchError) throw fetchError;

    const friendsList = friendsData?.friends_list || [];

    if (friendsList.length === 0) {
      return res.json({ friends: [] });
    }

    const { data: friends, error: friendsError } = await supabase
      .from("users")
      .select("id, username, email, avatar_url, role")
      .in("id", friendsList);

    if (friendsError) throw friendsError;

    const friendsWithDetails = friends.map((f) => ({
      id: f.id,
      username: f.username,
      email: f.email,
      avatarURL: f.avatar_url,
      role: f.role,
    }));

    res.json({ friends: friendsWithDetails });
  } catch (err) {
    console.error("❌ GET FRIENDS ERROR:", err);
    res.status(500).json({ 
      message: "Failed to fetch friends",
      error: "SERVER_ERROR" 
    });
  }
});

/* ---------- PROFILE UPDATE ---------- */
app.post("/profile", async (req, res) => {
  try {
    const { uid, username, email } = req.body;

    if (!uid) {
      return res.status(400).json({ 
        message: "Please provide user id",
        error: "MISSING_UID" 
      });
    }

    const updateData = {
      updated_at: new Date().toISOString(),
    };

    if (username) updateData.username = username;
    if (email) updateData.email = email.toLowerCase();

    const { error } = await supabase
      .from("users")
      .update(updateData)
      .eq("id", uid);

    if (error) throw error;

    console.log("✅ Profile updated:", uid);

    res.json({ message: "Profile updated successfully" });
  } catch (err) {
    console.error("❌ PROFILE UPDATE ERROR:", err);
    res.status(500).json({ 
      message: "Failed to update profile",
      error: "SERVER_ERROR" 
    });
  }
});

/* ---------- CHANGE PASSWORD ---------- */
app.post("/changepass", async (req, res) => {
  try {
    const { uid, oldPassword, newPassword } = req.body;

    if (!uid || !oldPassword || !newPassword) {
      return res.status(400).json({ 
        message: "Please fill in all fields",
        error: "MISSING_FIELDS" 
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ 
        message: "New password must be at least 6 characters",
        error: "PASSWORD_TOO_SHORT" 
      });
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("password")
      .eq("id", uid)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.status(404).json({ 
          message: "User not found",
          error: "USER_NOT_FOUND" 
        });
      }
      throw error;
    }

    const match = await bcrypt.compare(oldPassword, user.password);
    if (!match) {
      return res.status(401).json({ 
        message: "Old password is incorrect",
        error: "INVALID_OLD_PASSWORD" 
      });
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    const { error: updateError } = await supabase
      .from("users")
      .update({
        password: hashed,
        updated_at: new Date().toISOString(),
      })
      .eq("id", uid);

    if (updateError) throw updateError;

    console.log("✅ Password changed:", uid);

    res.json({ message: "Password changed successfully" });
  } catch (err) {
    console.error("❌ CHANGE PASSWORD ERROR:", err);
    res.status(500).json({ 
      message: "Failed to change password",
      error: "SERVER_ERROR" 
    });
  }
});

/* ---------- UPLOAD FILE/IMAGE ---------- */
app.post("/upload", async (req, res) => {
  try {
    const { projectId, downloadURL, filename, storagePath, type, description } = req.body;

    if (!projectId || !downloadURL) {
      return res.status(400).json({ 
        message: "Please provide projectId and downloadURL",
        error: "MISSING_FIELDS" 
      });
    }

    console.log("📤 Upload request:", { projectId, filename, type });

    // บันทึกไฟล์ไปยัง files_project table
    const { data: uploadRecord, error: insertError } = await supabase
      .from("files_project")
      .insert([
        {
          project_id: projectId,
          download_url: downloadURL,
          filename: filename || "untitled",
          storage_path: storagePath || filename,
          type: type || "images",
          description: description || "",
          created_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (insertError) {
      console.error("❌ Insert error:", insertError);
      throw insertError;
    }

    console.log("✅ File uploaded successfully:", uploadRecord.id);

    res.json({
      message: "File uploaded successfully",
      file: {
        id: uploadRecord.id,
        projectId: uploadRecord.project_id,
        fileUrl: uploadRecord.download_url,
        filename: uploadRecord.filename,
        fileType: uploadRecord.type,
      },
    });
  } catch (err) {
    console.error("❌ UPLOAD ERROR:", err);
    res.status(500).json({
      message: "Failed to upload file",
      error: "SERVER_ERROR",
      details: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

/* ---------- GET PROJECT IMAGES ---------- */
app.post("/getprojectimages", async (req, res) => {
  try {
    const { projectIds } = req.body;

    if (!projectIds || !Array.isArray(projectIds)) {
      return res.status(400).json({ 
        message: "Please provide projectIds as array",
        error: "INVALID_PROJECT_IDS" 
      });
    }

    console.log("🖼️ Fetching images for projects:", projectIds);

    // ดึงรูปภาพล่าสุดจาก files_project โดยเอาเฉพาะรูปที่มี type = 'images'
    const { data: files, error } = await supabase
      .from("files_project")
      .select("project_id, download_url, created_at")
      .in("project_id", projectIds)
      .eq("type", "images")
      .order("created_at", { ascending: false });

    if (error) throw error;

    // สร้าง object ที่เก็บรูปล่าสุดของแต่ละ project
    const images = {};
    
    files.forEach((file) => {
      // เก็บเฉพาะรูปแรกของแต่ละ project (ล่าสุด)
      if (!images[file.project_id]) {
        images[file.project_id] = file.download_url;
      }
    });

    console.log("✅ Images fetched:", Object.keys(images).length);

    res.json({ images });
  } catch (err) {
    console.error("❌ GET PROJECT IMAGES ERROR:", err);
    res.status(500).json({ 
      message: "Failed to fetch images",
      error: "SERVER_ERROR" 
    });
  }
});

/* ---------- NEW PROJECT ---------- */
app.post("/newproject", async (req, res) => {
  try {
    const { projectName, description, createdBy, template } = req.body;

    if (!projectName) {
      return res.status(400).json({ 
        message: "Please provide project name",
        error: "MISSING_PROJECT_NAME" 
      });
    }

    console.log("🆕 Creating new project:", projectName);

    const creatorInfo = createdBy || { uid: "admin", name: "admin" };

    // 1️⃣ สร้าง project หลัก
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .insert([
        {
          project_name: projectName,
          template: template || "",
          description: description || "",
          images: null,
          members: [],
          created_by: creatorInfo,
          created_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (projectError) throw projectError;

    const projectId = project.id;
    console.log("✅ Project created with ID:", projectId);

    // 2️⃣ สร้าง project_details
    const { error: detailsError } = await supabase
      .from("project_details")
      .insert([
        {
          project_id: projectId,
          sequences: [],
          shot_status: [],
          asset_status: [],
          created_at: new Date().toISOString(),
        },
      ]);

    if (detailsError) {
      console.error("❌ Details creation error:", detailsError);
      throw detailsError;
    }
    console.log("✅ Project details created");

    // 3️⃣ สร้าง default folders (Assets, Shots, Tasks, Media)
    const defaultFolders = [
      { name: "Assets", description: "Asset management folder" },
      { name: "Shots", description: "Shot management folder" },
      { name: "Tasks", description: "Task management folder" },
      { name: "Media", description: "Media files folder" },
    ];

    const folderInserts = defaultFolders.map((folder) => ({
      project_id: projectId,
      folder_name: folder.name,
      description: folder.description,
      permissions: [],
      created_at: new Date().toISOString(),
    }));

    const { error: foldersError } = await supabase
      .from("project_folders")
      .insert(folderInserts);

    if (foldersError) {
      console.error("❌ Folders creation error:", foldersError);
      throw foldersError;
    }
    console.log("✅ Default folders created");

    console.log("🎉 Project setup completed:", projectId);

    res.status(201).json({
      message: "Project created successfully",
      projectId,
      project: {
        projectId,
        projectName,
      },
      token: "dummy-token",
      user: creatorInfo,
    });
  } catch (err) {
    console.error("❌ NEW_PROJECT ERROR:", err);
    res.status(500).json({ 
      message: "Failed to create project",
      error: "SERVER_ERROR",
      details: process.env.NODE_ENV === "development" ? String(err) : undefined,
    });
  }
});

app.delete("/deleteProject", async (req, res) => {
  const { projectId } = req.body;

  if (!projectId) {
    return res.status(400).json({
      message: "Project ID is required",
      error: "MISSING_PROJECT_ID",
    });
  }

  try {
    /* =======================
       1️⃣ ลิสต์ไฟล์ทั้งหมดใน folder
       ======================= */
    const folderPath = `projects/${projectId}`;

    const { data: files, error: listError } =
      await supabase.storage
        .from("project_images")
        .list(folderPath, { recursive: true });

    if (listError) {
      console.error("⚠️ List storage error:", listError.message);
    }

    /* =======================
       2️⃣ ลบไฟล์ทั้งหมด (ถ้ามี)
       ======================= */
    if (files && files.length > 0) {
      const filePaths = files.map(
        (file) => `${folderPath}/${file.name}`
      );

      const { error: removeError } = await supabase.storage
        .from("project_images")
        .remove(filePaths);

      if (removeError) {
        console.error("⚠️ Remove storage error:", removeError.message);
        // ไม่ throw เพื่อไม่ให้ DB ค้าง
      }
    }

    /* =======================
       3️⃣ ลบ DB (CASCADE)
       ======================= */
    const { data, error: deleteError } = await supabase
      .from("projects")
      .delete()
      .eq("id", projectId)
      .select("id");

    if (deleteError) {
      return res.status(500).json({
        message: "Delete project failed",
        error: deleteError.message,
      });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({
        message: "Project not found",
      });
    }

    res.json({
      message: "✅ Project + storage deleted successfully",
      projectId,
    });
  } catch (err) {
    console.error("❌ Delete project error:", err);
    res.status(500).json({
      message: "Unexpected error",
      error: err.message,
    });
  }
});

/* ---------- PROJECT DETAILS ---------- */
app.post("/projectdetails", async (req, res) => {
  try {
    const { projectId } = req.body;

    if (!projectId) {
      return res.status(400).json({ 
        message: "Please provide project id",
        error: "MISSING_PROJECT_ID" 
      });
    }

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single();

    if (projectError) {
      if (projectError.code === "PGRST116") {
        return res.status(404).json({ 
          message: "Project not found",
          error: "PROJECT_NOT_FOUND" 
        });
      }
      throw projectError;
    }

    const { data: details, error: detailsError } = await supabase
      .from("project_details")
      .select("*")
      .eq("project_id", projectId)
      .maybeSingle();

    if (detailsError && detailsError.code !== "PGRST116") throw detailsError;

    res.json({
      project: {
        ...project,
        projectId: project.id,
        projectName: project.project_name,
        createdAt: project.created_at,
        createdBy: project.created_by,
      },
      projectDetails: details,
    });
  } catch (err) {
    console.error("❌ PROJECT_DETAILS ERROR:", err);
    res.status(500).json({ 
      message: "Failed to fetch project details",
      error: "SERVER_ERROR" 
    });
  }
});

/* ---------- PROJECT INFO ---------- */
app.post("/projectinfo", async (req, res) => {
  try {
    const { projectId } = req.body;

    if (!projectId) {
      return res.status(400).json({ 
        message: "Please provide project id",
        error: "MISSING_PROJECT_ID" 
      });
    }

    const { data: project, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.status(404).json({ 
          message: "Project not found",
          error: "PROJECT_NOT_FOUND" 
        });
      }
      throw error;
    }

    res.json({ 
      project: {
        ...project,
        projectId: project.id,
        projectName: project.project_name,
      }
    });
  } catch (err) {
    console.error("❌ PROJECT_INFO ERROR:", err);
    res.status(500).json({ 
      message: "Failed to fetch project info",
      error: "SERVER_ERROR" 
    });
  }
});

/* ---------- PROJECT LIST ---------- */
app.post("/projectlist", async (req, res) => {
  try {
    const { uid } = req.body;

    if (!uid) {
      return res.status(400).json({ 
        message: "Please provide user id",
        error: "MISSING_UID" 
      });
    }

    console.log("📋 Fetching projects for user:", uid);

    // 1️⃣ โปรเจกต์ที่เราสร้าง (created_by.uid)
    const { data: createdProjects, error: createdError } = await supabase
      .from("projects")
      .select("*")
      .contains("created_by", { uid });

    if (createdError) throw createdError;

    // 2️⃣ โปรเจกต์ที่เราเป็นสมาชิก (members array contains uid)
    const { data: memberProjects, error: memberError } = await supabase
      .from("projects")
      .select("*")
      .contains("members", [uid]);

    if (memberError) throw memberError;

    // รวมผลลัพธ์และกันซ้ำด้วย Map
    const projectMap = new Map();

    [...(createdProjects || []), ...(memberProjects || [])].forEach((project) => {
      projectMap.set(project.id, {
        projectId: project.id,
        id: project.id,
        projectName: project.project_name,
        createdAt: project.created_at,
        createdBy: project.created_by,
        description: project.description,
        status: "Active",
        template: project.template,
        members: project.members,
        images: project.images,
      });
    });

    const projects = Array.from(projectMap.values());

    console.log("✅ Projects fetched:", projects.length);

    res.json({ projects });
  } catch (err) {
    console.error("❌ PROJECT_LIST ERROR:", err);
    res.status(500).json({ 
      message: "Failed to fetch projects",
      error: "SERVER_ERROR" 
    });
  }
});

/* ---------- PROJECT IMAGE (อัปเดต images array ใน projects) ---------- */
app.post("/projectimage", async (req, res) => {
  try {
    const { projectId, imageUrl } = req.body;

    if (!projectId || !imageUrl) {
      return res.status(400).json({ 
        message: "Please provide project id and image url",
        error: "MISSING_FIELDS" 
      });
    }

    const { data: project, error: fetchError } = await supabase
      .from("projects")
      .select("images")
      .eq("id", projectId)
      .single();

    if (fetchError) {
      if (fetchError.code === "PGRST116") {
        return res.status(404).json({ 
          message: "Project not found",
          error: "PROJECT_NOT_FOUND" 
        });
      }
      throw fetchError;
    }

    const updatedImages = project.images || [];
    if (!updatedImages.includes(imageUrl)) {
      updatedImages.push(imageUrl);
    }

    const { error: updateError } = await supabase
      .from("projects")
      .update({
        images: updatedImages,
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId);

    if (updateError) throw updateError;

    console.log("✅ Image added to project:", projectId);

    res.json({ message: "Image added to project", projectId });
  } catch (err) {
    console.error("❌ UPLOAD_PROJECT_IMAGE ERROR:", err);
    res.status(500).json({ 
      message: "Failed to add image to project",
      error: "SERVER_ERROR" 
    });
  }
});

/* ---------- ROOT ---------- */
app.get("/", (req, res) => {
  res.send("✅ API with Supabase is running!");
});

/* ---------- HEALTH CHECK ---------- */
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

/* ---------- LISTEN ---------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

export default app;