const express = require("express");
const mysql = require("mysql2/promise");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const Tesseract = require("tesseract.js");
const cron = require("node-cron");
require("dotenv").config();

const app = express();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024
    },
    fileFilter: (req, file, callback) => {
        const allowedTypes = [
            "image/jpeg",
            "image/png",
            "image/webp"
        ];

        if (allowedTypes.includes(file.mimetype)) {
            callback(null, true);
        } else {
            callback(
                new Error("Please upload a JPG, PNG, or WEBP image.")
            );
        }
    }
});

app.post("/api/schedules/recognize", (req, res) => {
    upload.single("timetable")(req, res, async (uploadError) => {
        if (uploadError) {
            return res.status(400).json({
                message: uploadError.message
            });
        }

        if (!req.file) {
            return res.status(400).json({
                message: "Please upload a timetable image."
            });
        }

        let worker;

        try {
            worker = await Tesseract.createWorker("eng");

            const result = await worker.recognize(req.file.buffer);

            return res.json({
                message: "Image text recognized successfully.",
                extractedText: result.data.text
            });
        } catch (error) {
            console.error("Timetable OCR error:", error.message);

            return res.status(500).json({
                message: "Could not read the timetable image."
            });
        } finally {
            if (worker) {
                await worker.terminate();
            }
        }
    });
});

app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const db = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: {
    ca: process.env.AIVEN_CA_CERT?.replace(/\\n/g, "\n"),
    rejectUnauthorized: true
},
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function createSectionSchedulesTable() {
    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS section_schedules (
                id INT AUTO_INCREMENT PRIMARY KEY,
                section VARCHAR(100) NOT NULL UNIQUE,
                monday_start TIME NULL,
                tuesday_start TIME NULL,
                wednesday_start TIME NULL,
                thursday_start TIME NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        console.log("Section schedules table is ready.");
    } catch (error) {
        console.error(
            "Could not create section schedules table:",
            error.message
        );
    }
}

async function markAbsentStudents() {
    try {
        const now = new Date();
        
        const currentTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
}).format(now);

if (currentTime < "17:00") {
    console.log("Absence check skipped: it is before 5:00 PM in Manila.");
    return;
}

        const weekday = new Intl.DateTimeFormat("en-US", {
            timeZone: "Asia/Manila",
            weekday: "long"
        }).format(now).toLowerCase();

        const schoolDays = [
            "monday",
            "tuesday",
            "wednesday",
            "thursday"
        ];

        if (!schoolDays.includes(weekday)) {
            return;
        }

        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Manila",
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).formatToParts(now);

        const dateParts = Object.fromEntries(
            parts.map(part => [part.type, part.value])
        );

        const attendanceDate =
            `${dateParts.year}-${dateParts.month}-${dateParts.day}`;

        const [result] = await db.execute(
            `INSERT INTO attendance
                (student_id, attendance_date, attendance_time, status)
             SELECT s.id, ?, '17:00:00', 'Absent'
             FROM students s
             WHERE NOT EXISTS (
                 SELECT 1
                 FROM attendance a
                 WHERE a.student_id = s.id
                   AND a.attendance_date = ?
             )
             AND EXISTS (
                 SELECT 1
                 FROM section_schedules ss
                 WHERE ss.section = s.section
             )
             ON DUPLICATE KEY UPDATE
             id = id`,
            [attendanceDate, attendanceDate]
        );

        console.log(
            `Automatic absence check completed for ${attendanceDate}. ` +
            `New absent records: ${result.affectedRows}`
        );
    } catch (error) {
        console.error("Automatic absence check error:", error.message);
    }
}

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
        console.error("Fetch students error:", error);
        res.status(500).json({
            message: "Failed to load students."
        });
    }
});

app.get("/api/attendance/today", async (req, res) => {
    try {
        const dateParts = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Manila",
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).formatToParts(new Date());

        const parts = Object.fromEntries(
            dateParts.map(part => [part.type, part.value])
        );

        const today = `${parts.year}-${parts.month}-${parts.day}`;

        const [rows] = await db.execute(
            `SELECT
                s.student_id AS studentId,
                s.full_name AS studentName,
                DATE_FORMAT(a.attendance_date, '%Y-%m-%d') AS attendanceDate,
                a.attendance_time AS attendanceTime,
                a.status
             FROM attendance AS a
             JOIN students AS s ON s.id = a.student_id
             WHERE a.attendance_date = ?
             ORDER BY a.attendance_time DESC`,
            [today]
        );

        res.json(rows);
    } catch (error) {
        console.error("Fetch today's attendance error:", error.message);
        res.status(500).json({
            message: "Failed to load today's attendance."
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
            `SELECT
             s.student_id AS studentId,
             s.full_name AS studentName,
             DATE_FORMAT(a.attendance_date, '%Y-%m-%d') AS attendanceDate,
             a.attendance_time AS attendanceTime,
             a.status
             FROM attendance AS a
             JOIN students AS s ON s.id = a.student_id
             WHERE a.attendance_date = ?
             ORDER BY a.attendance_time DESC`,
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

app.post("/api/attendance/record", async (req, res) => {
    const studentId = Number(req.body?.studentId);

    if (!Number.isSafeInteger(studentId) || studentId < 1) {
        return res.status(400).json({
            message: "A valid student ID is required."
        });
    }

    try {
        const [students] = await db.execute(
            `SELECT id, section
             FROM students
             WHERE id = ?`,
            [studentId]
        );

        if (students.length === 0) {
            return res.status(404).json({
                message: "Student not found."
            });
        }

        const student = students[0];
        const now = new Date();

        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Manila",
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).formatToParts(now);

        const dateParts = Object.fromEntries(
            parts.map(part => [part.type, part.value])
        );

        const attendanceDate =
            `${dateParts.year}-${dateParts.month}-${dateParts.day}`;

        const attendanceTime = new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Manila",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23"
        }).format(now);

        const weekday = new Intl.DateTimeFormat("en-US", {
            timeZone: "Asia/Manila",
            weekday: "long"
        }).format(now).toLowerCase();

        const startTimeColumns = {
            monday: "monday_start",
            tuesday: "tuesday_start",
            wednesday: "wednesday_start",
            thursday: "thursday_start"
        };

        const startTimeColumn = startTimeColumns[weekday];

        if (!startTimeColumn) {
            return res.status(400).json({
                message: "Attendance recording is available Monday through Thursday only."
            });
        }

        const [schedules] = await db.execute(
            `SELECT ${startTimeColumn} AS startTime
             FROM section_schedules
             WHERE section = ?`,
            [student.section]
        );

        if (
            schedules.length === 0 ||
            !schedules[0].startTime
        ) {
            return res.status(409).json({
                message: "No confirmed schedule was found for this student's section."
            });
        }

        const startTime = String(schedules[0].startTime);
        const currentTime = attendanceTime;

        const status =
            currentTime <= startTime ? "Present" : "Late";

        try {
            await db.execute(
                `INSERT INTO attendance
                    (student_id, attendance_date, attendance_time, status)
                 VALUES (?, ?, ?, ?)`,
                [studentId, attendanceDate, attendanceTime, status]
            );

            return res.status(201).json({
                recorded: true,
                message: `${status} attendance recorded successfully.`,
                attendanceDate,
                attendanceTime,
                status
            });
        } catch (error) {
            if (error.code === "ER_DUP_ENTRY") {
                return res.status(409).json({
                    recorded: false,
                    message: "Attendance has already been recorded today."
                });
            }

            throw error;
        }
    } catch (error) {
        console.error("Record attendance error:", error.message);

        return res.status(500).json({
            message: "Could not record attendance."
        });
    }
});


app.post("/api/schedules/save", async (req, res) => {
    const { section, monday, tuesday, wednesday, thursday } =
        req.body || {};

    const times = [monday, tuesday, wednesday, thursday];

    if (typeof section !== "string" || !section.trim()) {
        return res.status(400).json({
            message: "Please provide a section name."
        });
    }

    const validTime = value =>
        typeof value === "string" &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

    if (!times.every(validTime)) {
        return res.status(400).json({
            message: "Enter a valid start time for all four school days using HH:MM format."
        });
    }

    try {
        await db.execute(
            `INSERT INTO section_schedules
                (section, monday_start, tuesday_start,
                 wednesday_start, thursday_start)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                monday_start = VALUES(monday_start),
                tuesday_start = VALUES(tuesday_start),
                wednesday_start = VALUES(wednesday_start),
                thursday_start = VALUES(thursday_start)`,
            [
                section.trim(),
                `${monday}:00`,
                `${tuesday}:00`,
                `${wednesday}:00`,
                `${thursday}:00`
            ]
        );

        return res.json({
            message: "Section schedule saved successfully."
        });
    } catch (error) {
        console.error("Save schedule error:", error.message);

        return res.status(500).json({
            message: "Could not save the section schedule."
        });
    }
});

(async () => {
    await createSectionSchedulesTable();

    cron.schedule(
        "0 17 * * 1-4",
        async () => {
            await markAbsentStudents();
        },
        {
            timezone: "Asia/Manila"
        }
    );

    const now = new Date();

    const weekday = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Manila",
        weekday: "long"
    }).format(now).toLowerCase();

    const currentTime = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Manila",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
    }).format(now);

    if (
        ["monday", "tuesday", "wednesday", "thursday"].includes(weekday) &&
        currentTime >= "17:00"
    ) {
        await markAbsentStudents();
    }

    app.listen(PORT, "0.0.0.0", () => {
        console.log(`CLASSSCAN server running on port ${PORT}`);
        console.log(
            "Automatic absence check scheduled for 5:00 PM, Monday–Thursday."
        );
    });
})();
