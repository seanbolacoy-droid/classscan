const express = require("express");
const mysql = require("mysql2/promise");
const path = require("path");
require("dotenv").config();

const app = express();

app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const db = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

app.get("/api/health", (req, res) => {
    res.json({
        status: "ok",
        message: "CLASSSCAN backend is running"
    });
});

app.get("/api/db-test", async (req, res) => {
    try {
        const [rows] = await db.query(
            "SELECT DATABASE() AS databaseName"
        );

        res.json({
            status: "connected",
            database: rows[0].databaseName
        });
    } catch (error) {
        console.error("Database connection failed:", error.message);
        res.status(500).json({
            status: "error",
            message: "Could not connect to the database."
        });
    }
});

app.get("/api/students", async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT id, student_id AS studentId,
                    full_name AS studentName, section
             FROM students
             ORDER BY id DESC`
        );

        res.json(rows);
    } catch (error) {
        console.error("Fetch students error:", error.message);
        res.status(500).json({
            message: "Failed to load students."
        });
    }
});

app.post("/api/students", async (req, res) => {
    try {
        const { studentId, studentName, section } = req.body;

        if (
            typeof studentId !== "string" || !studentId.trim() ||
            typeof studentName !== "string" || !studentName.trim() ||
            typeof section !== "string" || !section.trim()
        ) {
            return res.status(400).json({
                message: "Please complete all student fields."
            });
        }

        const [result] = await db.execute(
            `INSERT INTO students
             (student_id, full_name, section)
             VALUES (?, ?, ?)`,
            [studentId.trim(), studentName.trim(), section.trim()]
        );

        res.status(201).json({
            message: "Student added successfully.",
            id: result.insertId
        });
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                message: "That student ID already exists."
            });
        }

        console.error("Add student error:", error.message);
        res.status(500).json({
            message: "Failed to add student."
        });
    }
});

app.post("/api/students/:id/face-enrollment", async (req, res) => {
    const studentId = Number(req.params.id);
    const descriptor = req.body?.descriptor;

    if (!Number.isSafeInteger(studentId) || studentId < 1) {
        return res.status(400).json({
            message: "Invalid student record ID."
        });
    }

    if (
        !Array.isArray(descriptor) ||
        descriptor.length !== 128 ||
        !descriptor.every(
            value => typeof value === "number" && Number.isFinite(value)
        )
    ) {
        return res.status(400).json({
            message: "A valid 128-number face descriptor is required."
        });
    }

    try {
        const [students] = await db.execute(
            "SELECT id FROM students WHERE id = ?",
            [studentId]
        );

        if (students.length === 0) {
            return res.status(404).json({
                message: "Student not found."
            });
        }

        await db.execute(
            `INSERT INTO face_enrollments
                (student_id, face_descriptor)
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE
                face_descriptor = VALUES(face_descriptor),
                created_at = CURRENT_TIMESTAMP`,
            [studentId, JSON.stringify(descriptor)]
        );

        res.status(201).json({
            message: "Face enrollment saved."
        });
    } catch (error) {
        console.error("Face enrollment error:", error.message);
        res.status(500).json({
            message: "Could not save face enrollment."
        });
    }
});

app.post("/api/face-match", async (req, res) => {
    const descriptor = req.body?.descriptor;

    if (
        !Array.isArray(descriptor) ||
        descriptor.length !== 128 ||
        !descriptor.every(
            value => typeof value === "number" && Number.isFinite(value)
        )
    ) {
        return res.status(400).json({
            message: "A valid 128-number face descriptor is required."
        });
    }

    try {
        const [rows] = await db.query(
            `SELECT s.id, s.student_id AS studentId,
                    s.full_name AS studentName, s.section,
                    f.face_descriptor AS faceDescriptor
             FROM face_enrollments f
             JOIN students s ON s.id = f.student_id`
        );

        let bestMatch = null;
        let bestDistance = Infinity;

        for (const row of rows) {
            let savedDescriptor = row.faceDescriptor;

            if (typeof savedDescriptor === "string") {
                savedDescriptor = JSON.parse(savedDescriptor);
            }

            if (
                !Array.isArray(savedDescriptor) ||
                savedDescriptor.length !== 128
            ) {
                continue;
            }

            let sum = 0;

            for (let i = 0; i < 128; i++) {
                const difference = descriptor[i] - savedDescriptor[i];
                sum += difference * difference;
            }

            const distance = Math.sqrt(sum);

            if (distance < bestDistance) {
                bestDistance = distance;
                bestMatch = row;
            }
        }

        if (!bestMatch || bestDistance > 0.5) {
            return res.json({
                matched: false,
                message: "No sufficiently close enrolled face match."
            });
        }

        res.json({
            matched: true,
            student: {
                id: bestMatch.id,
                studentId: bestMatch.studentId,
                studentName: bestMatch.studentName,
                section: bestMatch.section
            },
            distance: Number(bestDistance.toFixed(4)),
            message: "Candidate match found. Verify before recording attendance."
        });
    } catch (error) {
        console.error("Face matching error:", error.message);
        res.status(500).json({
            message: "Could not compare enrolled faces."
        });
    }
});

app.delete("/api/students/:id/face-enrollment", async (req, res) => {
    const studentId = Number(req.params.id);

    if (!Number.isSafeInteger(studentId) || studentId < 1) {
        return res.status(400).json({
            message: "Invalid student record ID."
        });
    }

    try {
        const [result] = await db.execute(
            "DELETE FROM face_enrollments WHERE student_id = ?",
            [studentId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                message: "No face enrollment found for that student."
            });
        }

        res.json({
            message: "Face enrollment deleted."
        });
    } catch (error) {
        console.error("Delete face enrollment error:", error.message);
        res.status(500).json({
            message: "Could not delete face enrollment."
        });
    }
});

app.delete("/api/students/:id", async (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
        return res.status(400).json({
            message: "Invalid student ID."
        });
    }

    try {
        const [result] = await db.execute(
            "DELETE FROM students WHERE id = ?",
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                message: "Student not found."
            });
        }

        res.json({
            message: "Student deleted successfully."
        });
    } catch (error) {
        console.error("Delete student error:", error.message);
        res.status(500).json({
            message: "Failed to delete student."
        });
    }
});

const PORT = Number(process.env.PORT || 3000);

async function startServer() {
    try {
        const connection = await db.getConnection();

        console.log(
            "Connected to MySQL database:",
            process.env.DB_NAME
        );

        connection.release();

    
        app.listen(PORT, "127.0.0.1", () => {
            console.log(
                `CLASSSCAN server running at http://localhost:${PORT}`
            );
        });
    } catch (error) {
        console.error("Could not connect to MySQL:", error.message);
        process.exitCode = 1;
    }
}

startServer();
