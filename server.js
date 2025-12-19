import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import bcrypt from "bcrypt";
import admin from "firebase-admin";

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Firebase Admin SDK initialization
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: "shotgrid-promax",
    clientEmail: "firebase-adminsdk-fbsvc@shotgrid-promax.iam.gserviceaccount.com",
    privateKey: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDOFhi8u4BmV6qH\n9RNrgIKNyfLQUJmznOGrRaGfPXX9FyKn06wlnGrGyPBr1ur6RrSd+DnFI6/XAOfK\nPnDJSed/8AenNOaRiYKkN6LXxVjRs4wVevd086JXsSYvkpQXmfRTF/EXASINewfg\nbKIsjO2mupMqngCUn6QmtYENwb2T2gMFm97hKK2zaBs/3Jq+/LtQbWdHDDVlfaEp\nVNHihNTNDY1K4g38gjX7y0iVxlVZDsMQ31dS5CjKh1ud4Src8SveyzXyREEc18YG\njCRTqfjQQ1QYibg5B71wuUd0ld2i7FwuwHyXBLxEzkJeYEu9yoe1elQXI13qQbbT\nZgjAfDAdAgMBAAECggEAU91HHMqasksbkO8pA3bM6gFUB/S8z4xYg1e3MTOUJ7W5\n+xzW8YlJJHLR77iKb+XFC4HflHt0y6RJLxKg2DD0fapCmwcaiwAwAz7GzFK5VcDg\nkT80o0mf91qWJQbbsA0NEaFtEUT7RAwchPYAOuvwrAhB6jZZGyIp7Tywc1YznQ4A\nZH8+It4PcihSrdEj8p0tFrQKDpNu7lJVQDYszr/hUNvzaovNwmR9llz1uXL01LIo\nmVbli+9jEJ1CbsbWbS9p7rLWUgDIJyY/KEXR1knIBtnG30EzElIUkCoH3HvdCLNm\nXXDyIXIXW+yH9ArJfuLQRYwKmLz9AMnldkXGiVoTewKBgQDsvgJs7RLoLDk156ie\nZvLCWkKLm94KDcA0MKQVfAHMZ09na64N+KKfvn29sBOCK1vw/JDPMxfG5Elyp6kL\njwkrvk5mISOX/KzF/1R6IXGM//SMSaRfwqzvNMA6sHOKNbANz1jT4ub98t2w1+BO\noMZ1AOQUxTPDTV6waMFJJ0JnKwKBgQDe2bMKHseIN5/PbIadsg1dIgYgBZuN7nD/\ndgee9M9kXiW8y/NEMxkUhS81fb/bjpTEp7kf7JG6VHkxXxD4jFgnYro+vUzGrAas\ntD1BU4cYnjoY7I+TVmS483OfsVs4B9Uj9gsksdRZ/JFEI0D4ly8YHGlIyqRumU6v\nUFXT08Eh1wKBgQDOYz/eEjf/bD5b/h+EKJ/OS73j0/iYrzA2z4jcqgUvW4lf0gIl\nb/LmbL1WFyCKxJ4c0zKzUAmUfQSDDiNTTlliZ0AVzSIoqEE/Q78z0eAaWjGp87F3\nQlJdH5HOGHJBtVhMUc1Qu2lBTu9x8mE8avFYo3Qzn0/nHZZFGK4Yxj8fjQKBgAmL\ne36oeNVdxIuG03E3qhjeFzMR6mq21sIqVQM66xMacTVX6vB129IkLjR1UV1fCwIt\nSOGUKV24toQl1T1ADZqKQP3k77/mqFaHVcRRhozIYialIzUlUyUU0FP7rbOFqlxi\n8nE86KJ+Dd7EP8kl+I9o0B2dCFPwXw1lPHfZLwF7AoGARQLSgZztz87pKNWT2IEx\nTFXpx8M+lh1XWRWkzAu8Cc3cOGe8aqrU8+6S8MODQLDRhZAFa2yL3CqNWfIH6DGL\nHYZQTENQrPYu+FXEfxjrVWHq5cODlMrg94NjZ9dQ9VxBn5lJC0Ic+QHV7Ze21Ljs\netPXMzP3nxBsCDpybcvr/DI=\n-----END PRIVATE KEY-----\n",
    
  }),
    storageBucket: "shotgrid-promax.appspot.com"
});

const db = admin.firestore();
export const bucket = admin.storage().bucket();

/* ---------- ROUTES ---------- */
// Registration route
app.post("/register", async (req, res) => {
  try {
    const { username, email, password, role } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: "กรุณากรอกข้อมูลให้ครบ" });
    }

    const snap = await db.collection("users").where("email", "==", email).get();
    if (!snap.empty) {
      return res.status(400).json({ error: "อีเมลนี้มีผู้ใช้งานแล้ว" });
    }

    const hashed = await bcrypt.hash(password, 10);

    const ref = db.collection("users").doc();
    await ref.set({
      uid: ref.id,
      username,
      email,
      password: hashed,
      role: role || "user",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const ref2 = db.collection("friends").doc();
    await ref2.set({
      uid: ref.id,
      friendsList: [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }); 

    res.json({ message: "สมัครสมาชิกสำเร็จ" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

// Login route
app.post("/login", async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ error: "กรุณาใส่ email หรือ username และ password" });
    }

    const usersRef = db.collection("users");

    // เช็ค email ก่อน
    let snapshot = await usersRef
      .where("email", "==", identifier)
      .limit(1)
      .get();

    // ถ้าไม่เจอ email → เช็ค username
    if (snapshot.empty) {
      snapshot = await usersRef
        .where("username", "==", identifier)
        .limit(1)
        .get();
    }

    if (snapshot.empty) {
      return res.status(401).json({ error: "User not found" });
    }

    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();

    // เช็ค password
    const isValid = await bcrypt.compare(password, userData.password);
    if (!isValid) {
      return res.status(401).json({ error: "Invalid password" });
    }

    // ส่ง response ถูกต้อง
    res.json({
      message: "เข้าสู่ระบบสำเร็จ",
      uid: userData.uid,
      email: userData.email,
      role: userData.role,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

app.post("/getuser", async (req, res) => {
  try {
    const { uid } = req.body;
    if (!uid) {
      return res.status(400).json({ error: "กรุณาส่ง uid" });
    }

    const ref = db.collection("users").doc(uid);
    const doc = await ref.get();

    if (!doc.exists) {
      return res.status(404).json({ error: "ไม่พบบัญชีผู้ใช้" });
    }

    const data = doc.data();
    res.json({
      uid: data.uid,
      username: data.username,
      email: data.email,
      role: data.role,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

app.post("/searchuser", async (req, res) => {
  try {
    let { query } = req.body;

    if (!query) {
      return res.status(400).json({ error: "กรุณาส่ง query" });
    }

    // normalize
    query = query.toLowerCase().trim();

    const usersRef = db.collection("users");

    /* 🔹 query ที่ 1 : searchKeywords (แนะนำ) */
    const keywordSnap = await usersRef
      .where("searchKeywords", "array-contains", query)
      .limit(10)
      .get();

    let docs = keywordSnap.docs;

    /* 🔹 fallback (กรณี user เก่าไม่มี searchKeywords) */
    if (docs.length === 0) {
      const [usernameSnap, emailSnap] = await Promise.all([
        usersRef
          .where("username", ">=", query)
          .where("username", "<=", query + "\uf8ff")
          .limit(10)
          .get(),

        usersRef
          .where("email", ">=", query)
          .where("email", "<=", query + "\uf8ff")
          .limit(10)
          .get(),
      ]);

      // merge + กันซ้ำ
      const map = new Map();
      [...usernameSnap.docs, ...emailSnap.docs].forEach((doc) => {
        map.set(doc.id, doc);
      });

      docs = [...map.values()];
    }

    const results = docs.map((doc) => {
      const data = doc.data();
      return {
        uid: data.uid || doc.id,
        username: data.username,
        email: data.email,
      };
    });

    res.json({ results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});


// Add friend route

app.put("/addfriend", async (req, res) => {
  try {
    const { uid, friendUid } = req.body;

    if (!uid || !friendUid) {
      return res.status(400).json({ error: "กรุณาส่ง uid และ friendUid" });
    }

    /* 1. ตรวจสอบ friendUid จาก users */
    const friendRef = db.collection("users").doc(friendUid);
    const friendDoc = await friendRef.get();

    if (!friendDoc.exists) {
      return res.status(404).json({ error: "ไม่พบบัญชีเพื่อน" });
    }

    /* 2. อ้างอิง friends/{uid} */
    const userFriendRef = db.collection("friends").doc(uid);
    const userFriendDoc = await userFriendRef.get();

    let friendsList = [];

    if (userFriendDoc.exists) {
      friendsList = userFriendDoc.data().friendsList || [];

      if (friendsList.includes(friendUid)) {
        return res.status(400).json({ error: "เพื่อนนี้ถูกเพิ่มแล้ว" });
      }
    }

    /* 3. เพิ่ม friendUid */
    friendsList.push(friendUid);

    /* 4. ใช้ set + merge เพื่อรองรับกรณีไม่มี doc */
    await userFriendRef.set(
      {
        friendsList,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    res.json({
      message: "เพิ่มเพื่อนสำเร็จ",
      friendsList,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

// Profile update route
app.post("/profile", async (req, res) => {
  try {
    const { uid, username, email } = req.body;
    if (!uid) {
      return res.status(400).json({ error: "กรุณาส่ง uid ของผู้ใช้" });
    }

    const ref = db.collection("users").doc(uid);
    await ref.update({
      username,
      email,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ message: "อัปเดตโปรไฟล์สำเร็จ" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

// Password change route
app.post("/changepass", async (req, res) => {
  try {
    const { uid, oldPassword, newPassword } = req.body;
    if (!uid || !oldPassword || !newPassword) {
      return res.status(400).json({ error: "กรุณากรอกข้อมูลให้ครบ" });
    }

    const ref = db.collection("users").doc(uid);
    const doc = await ref.get();
    if (!doc.exists) {
      return res.status(404).json({ error: "ไม่พบบัญชีผู้ใช้" });
    }

    const user = doc.data();
    const match = await bcrypt.compare(oldPassword, user.password);
    if (!match) {
      return res.status(401).json({ error: "รหัสผ่านเก่าไม่ถูกต้อง" });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await ref.update({
      password: hashed,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ message: "เปลี่ยนรหัสผ่านสำเร็จ" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

//upload pending file route
app.post("/pending", async (req, res) => {
  try {
    const { downloadURL, filename, type, description, uploadedBy } = req.body;

    if (!downloadURL || !type) {
      return res.status(400).json({ error: "missing fields" });
    }

    const docRef = db.collection("files_pending").doc();
    const file_id = docRef.id;

    await docRef.set({
      file_id,
      downloadURL,
      filename: filename || "",
      type,
      description: description || "",
      status: "pending",

      uploadedBy: uploadedBy || {
        uid: "anonymous",
        name: "unknown",
      },

      createdAt: new Date().toISOString(),
    });

    res.json({ message: "pending uploaded", file_id });
  } catch (err) {
    console.error("UPLOAD_PENDING ERROR:", err);
    res.status(500).json({ error: String(err) });
  }
});

//approve file route
app.post("/approved", async (req, res) => {
  try {
    const { file_id, approvedBy } = req.body;

    if (!file_id) {
      return res.status(400).json({ error: "missing file_id" });
    }

    const pendingRef = db.collection("files_pending").doc(file_id);
    const snap = await pendingRef.get();

    if (!snap.exists) {
      return res.status(404).json({ error: "pending not found" });
    }

    const data = snap.data();
    const bucket = admin.storage().bucket();

    const oldPath = data.storagePath; // pending/images/xxx.jpg
    const newPath = oldPath.replace("pending/", "approved/");

    await bucket.file(oldPath).copy(bucket.file(newPath));

    const [approvedUrl] = await bucket
      .file(newPath)
      .getSignedUrl({
        action: "read",
        expires: "03-01-2500",
      });

    await db.collection("files_approved").doc(file_id).set({
      ...data,
      downloadURL: approvedUrl,
      storagePath: newPath,
      status: "approved",
      approvedAt: new Date().toISOString(),
      approvedBy: approvedBy || { uid: "admin", name: "admin" },
    });

    await db.collection("files_history").add({
      file_id,
      action: "approved",
      from: "pending",
      to: "approved",
      at: new Date().toISOString(),
    });

    res.json({ message: "approved success", file_id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

app.post("/newproject", async (req, res) => {
  try {
    const { projectName, description, createdBy } = req.body;

    if (!projectName) {
      return res.status(400).json({ error: "missing projectName" });
    }

    const docRef = db.collection("projects").doc();
    const projectId = docRef.id;

    await docRef.set({
      projectId,
      projectName,
      description: description || "",
      images: null,
      createdBy: createdBy || { uid: "admin", name: "admin" },
      createdAt: new Date().toISOString(),
    });

    const data_project = db.collection("project_details").doc();
    await data_project.set({
      projectId,
      Sequences: [
        { WaitToStart: null, Final: null, Inprogress: null, blank: null},
      
      ],
      ShotStatus: [
        { Final: null, WaitToStart: null , Inprogress: null, blank: null },
      ],
      AssetStatus: [
        { Art: null, Model: null, Rig: null , Texture: null, Layout: null , Animation: null, FX: null, Light: null, Comp: null },
      ],
      createdAt: new Date().toISOString(),
    });

    res.json({ message: "project created", projectId });
  } catch (err) {
    console.error("NEW_PROJECT ERROR:", err);
    res.status(500).json({ error: String(err) });
  }
});

app.get("/projectlist", async (req, res) => {
  try {
    const snapshot = await db.collection("projects").get();
    const projects = snapshot.docs.map((doc) => doc.data());
    res.json({ projects });
  } catch (err) {
    console.error("PROJECT_LIST ERROR:", err);
    res.status(500).json({ error: String(err) });
  }
});

app.post("/projectimage", async (req, res) => {
  try {
    const { projectId, imageUrl } = req.body;

    if (!projectId || !imageUrl) {
      return res.status(400).json({ error: "missing fields" });
    }

    const projectRef = db.collection("projects").doc(projectId);
    const snap = await projectRef.get();

    if (!snap.exists) {
      return res.status(404).json({ error: "project not found" });
    }

    const projectData = snap.data();
    const updatedImages = projectData.images || [];
    updatedImages.push(imageUrl);

    await projectRef.update({
      images: updatedImages,
      updatedAt: new Date().toISOString(),
    });

    res.json({ message: "image added to project", projectId });
  } catch (err) {
    console.error("UPLOAD_PROJECT_IMAGE ERROR:", err);
    res.status(500).json({ error: String(err) });
  }
});

/* ---------- ROOT ---------- */
app.get("/", (req, res) => {
  res.send("✅ API with Firestore is running!");
});

/* ---------- LISTEN  ---------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

export default app;