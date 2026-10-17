function updateDateTime() {
    const now = new Date();

    const dateElement = document.getElementById("currentDate");
    const timeElement = document.getElementById("currentTime");

    if (dateElement) {
        dateElement.textContent = now.toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric"
        });
    }

    if (timeElement) {
        timeElement.textContent = now.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            second: "2-digit",
            hour12: true
        });
    }
}

updateDateTime();
setInterval(updateDateTime, 1000);

const registerForm = document.getElementById("registerForm");

if (registerForm) {
    registerForm.addEventListener("submit", function (event) {
        event.preventDefault();

        const fullName = document.getElementById("fullName").value.trim();
        const username = document.getElementById("registerUsername").value.trim();
        const email = document.getElementById("registerEmail").value.trim();
        const password = document.getElementById("registerPassword").value;
        const confirmPassword = document.getElementById("confirmPassword").value;
        const message = document.getElementById("registerMessage");

        if (password !== confirmPassword) {
            message.textContent = "Passwords do not match.";
            return;
        }

        const newUser = { fullName, username, email, password };

        localStorage.setItem("classScanUser", JSON.stringify(newUser));

        message.textContent = "Account created successfully!";

        setTimeout(function () {
            window.location.href = "login.html";
        }, 1000);
    });
}

const loginForm = document.getElementById("loginForm");

if (loginForm) {
    loginForm.addEventListener("submit", function (event) {
        event.preventDefault();

        const username = document.getElementById("loginUsername").value.trim();
        const password = document.getElementById("loginPassword").value;
        const message = document.getElementById("loginMessage");
        const savedUser = localStorage.getItem("classScanUser");

        if (!savedUser) {
            message.textContent =
                "No account found. Please create an account first.";
            return;
        }

        const user = JSON.parse(savedUser);

        if (username === user.username && password === user.password) {
            message.textContent = "Login successful!";
            localStorage.setItem("classScanLoggedIn", "true");

            setTimeout(function () {
                window.location.href = "website.html";
            }, 700);
        } else {
            message.textContent = "Incorrect username or password.";
        }
    });
}

function logout() {
    if (confirm("Are you sure you want to log out?")) {
        localStorage.removeItem("classScanLoggedIn");
        window.location.href = "login.html";
    }
}

function startScan() {
    window.location.href = "attendance.html";
}

const studentForm = document.getElementById("studentForm");
const studentTable = document.getElementById("studentTable");
const studentSearch = document.getElementById("studentSearch");

let studentsCache = [];

async function showStudents() {
    if (!studentTable) return;

    try {
        const response = await fetch("/api/students");

        if (!response.ok) {
            throw new Error("Could not load students.");
        }

        studentsCache = await response.json();
        renderStudents();
    } catch (error) {
        console.error("Load students error:", error);

        studentTable.replaceChildren();

        const row = document.createElement("tr");
        const cell = document.createElement("td");

        cell.colSpan = 4;
        cell.textContent =
            "Could not load students. Please check the server.";

        row.appendChild(cell);
        studentTable.appendChild(row);
    }
}

function renderStudents() {
    if (!studentTable) return;

    const search = studentSearch
        ? studentSearch.value.trim().toLowerCase()
        : "";

    const filteredStudents = studentsCache.filter(student =>
        String(student.studentId ?? "").toLowerCase().includes(search) ||
        String(student.studentName ?? "").toLowerCase().includes(search) ||
        String(student.section ?? "").toLowerCase().includes(search)
    );

    studentTable.replaceChildren();

    filteredStudents.forEach(student => {
        const row = document.createElement("tr");

        [
            student.studentId,
            student.studentName,
            student.section
        ].forEach(value => {
            const cell = document.createElement("td");
            cell.textContent = value ?? "";
            row.appendChild(cell);
        });

        const actionCell = document.createElement("td");
        const deleteButton = document.createElement("button");

        deleteButton.type = "button";
        deleteButton.className = "delete-button";
        deleteButton.textContent = "Delete";

        deleteButton.addEventListener("click", function () {
            deleteStudent(student.id, student.studentName);
        });

        actionCell.appendChild(deleteButton);
        row.appendChild(actionCell);
        studentTable.appendChild(row);
    });
}

if (studentForm) {
    studentForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        const studentId = document.getElementById("studentId").value.trim();
        const studentName = document.getElementById("studentName").value.trim();
        const section = document.getElementById("studentSection").value.trim();
        const message = document.getElementById("studentMessage");

        try {
            const response = await fetch("/api/students", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    studentId,
                    studentName,
                    section
                })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || "Failed to add student.");
            }

            if (message) {
                message.textContent = "Student added successfully!";
            }

            studentForm.reset();
            await showStudents();
        } catch (error) {
            if (message) message.textContent = error.message;
            console.error("Add student error:", error);
        }
    });
}

async function deleteStudent(id, studentName) {
    if (!confirm("Are you sure you want to delete " + studentName + "?")) {
        return;
    }

    try {
        const response = await fetch(
            "/api/students/" + encodeURIComponent(id),
            { method: "DELETE" }
        );

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || "Failed to delete student.");
        }

        await showStudents();
    } catch (error) {
        alert(error.message);
        console.error("Delete student error:", error);
    }
}

if (studentSearch) {
    studentSearch.addEventListener("input", renderStudents);
}

showStudents();

const savedUser = localStorage.getItem("classScanUser");

if (savedUser) {
    try {
        const user = JSON.parse(savedUser);

        const profileName = document.getElementById("profileName");
        const profileUsername = document.getElementById("profileUsername");
        const profileIcon = document.getElementById("profileIcon");

        if (profileName) profileName.textContent = user.fullName;
        if (profileUsername) profileUsername.textContent = "@" + user.username;

        if (profileIcon) {
            profileIcon.textContent = (user.fullName || "?")
                .charAt(0).toUpperCase();
        }
    } catch (error) {
        console.error("Profile loading error:", error);
    }
}

const faceVideo = document.getElementById("faceVideo");
const faceCanvas = document.getElementById("faceCanvas");
const startCameraButton = document.getElementById("startCameraButton");
const stopCameraButton = document.getElementById("stopCameraButton");
const cameraStatus = document.getElementById("cameraStatus");

let faceCameraStream = null;
let faceDetectionRunning = false;
let faceDetectionModelsLoaded = false;
let faceDetectionLoopId = null;
let faceDetectionBusy = false;

async function loadFaceDetectionModels() {
    if (faceDetectionModelsLoaded) return;

    if (typeof faceapi === "undefined") {
        throw new Error("The face-api.js library did not load.");
    }

    cameraStatus.textContent = "Loading face detection models...";

    await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(
            "/models/tiny_face_detector"
        ),
        faceapi.nets.faceLandmark68Net.loadFromUri(
            "/models/face_landmark_68"
        ),
        faceapi.nets.faceRecognitionNet.loadFromUri(
            "/models/face_recognition"
        )
    ]);

    faceDetectionModelsLoaded = true;
}

async function detectFaces() {
    if (!faceDetectionRunning || !faceVideo || !faceCanvas) return;

    try {
        if (
            faceVideo.readyState >= 2 &&
            faceVideo.videoWidth > 0 &&
            faceVideo.videoHeight > 0 &&
            !faceDetectionBusy
        ) {
            faceDetectionBusy = true;

            const displaySize = {
                width: faceVideo.clientWidth,
                height: faceVideo.clientHeight
            };

            const pixelRatio = window.devicePixelRatio || 1;

            faceCanvas.width = Math.round(displaySize.width * pixelRatio);
            faceCanvas.height = Math.round(displaySize.height * pixelRatio);

            faceCanvas.style.width = displaySize.width + "px";
            faceCanvas.style.height = displaySize.height + "px";

            const context = faceCanvas.getContext("2d");
            context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
            context.clearRect(
                0,
                0,
                displaySize.width,
                displaySize.height
            );

            const detections = await faceapi
                .detectAllFaces(
                    faceVideo,
                    new faceapi.TinyFaceDetectorOptions()
                )
                .withFaceLandmarks();

            if (faceDetectionRunning) {
                const resizedDetections = faceapi.resizeResults(
                    detections,
                    displaySize
                );

                faceapi.draw.drawDetections(
                    faceCanvas,
                    resizedDetections
                );

                if (cameraStatus) {
                    if (detections.length === 0) {
                        cameraStatus.textContent =
                            "Camera running. No face detected.";
                    } else {
                        cameraStatus.textContent =
                            detections.length +
                            (detections.length === 1
                                ? " face detected."
                                : " faces detected.") +
                            " Identity has not been verified.";
                    }
                }
            }
        }
    } catch (error) {
        console.error("Face detection error:", error);

        if (cameraStatus) {
            cameraStatus.textContent =
                "Face detection encountered an error. Check the browser console.";
        }
    } finally {
        faceDetectionBusy = false;
    }

    if (faceDetectionRunning) {
        faceDetectionLoopId = requestAnimationFrame(detectFaces);
    }
}

async function startFaceCamera() {
    if (faceDetectionRunning) return;

    if (!faceVideo || !faceCanvas || !cameraStatus) return;

    try {
        await loadFaceDetectionModels();

        if (!faceCameraStream) {
            cameraStatus.textContent = "Requesting camera permission...";

            faceCameraStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: false
            });

            faceVideo.srcObject = faceCameraStream;
        }

        await faceVideo.play();

        if (faceVideo.readyState < 2) {
            await new Promise(resolve => {
                faceVideo.addEventListener("loadeddata", resolve, {
                    once: true
                });
            });
        }

        faceDetectionRunning = true;
        cameraStatus.textContent = "Camera running. Looking for faces...";

        detectFaces();
    } catch (error) {
        console.error("Camera or model error:", error);

        faceDetectionRunning = false;

        if (cameraStatus) {
            if (error.name === "NotAllowedError") {
                cameraStatus.textContent =
                    "Camera permission denied. Allow camera access in browser settings.";
            } else if (error.name === "NotFoundError") {
                cameraStatus.textContent =
                    "No camera found. Connect a camera and try again.";
            } else {
                cameraStatus.textContent =
                    "Could not start face detection. Check model files and browser console.";
            }
        }

        if (faceCameraStream) {
            faceCameraStream.getTracks().forEach(track => track.stop());
            faceCameraStream = null;
        }

        if (faceVideo) faceVideo.srcObject = null;
    }
}

function stopFaceCamera() {
    faceDetectionRunning = false;

    if (faceDetectionLoopId !== null) {
        cancelAnimationFrame(faceDetectionLoopId);
        faceDetectionLoopId = null;
    }

    if (faceCameraStream) {
        faceCameraStream.getTracks().forEach(track => track.stop());
        faceCameraStream = null;
    }

    if (faceVideo) faceVideo.srcObject = null;

    if (faceCanvas) {
        const context = faceCanvas.getContext("2d");
        context.clearRect(0, 0, faceCanvas.width, faceCanvas.height);
    }

    if (cameraStatus) {
        cameraStatus.textContent = "Camera stopped.";
    }
}

if (startCameraButton) {
    startCameraButton.addEventListener("click", startFaceCamera);
}

if (stopCameraButton) {
    stopCameraButton.addEventListener("click", stopFaceCamera);
}

window.addEventListener("beforeunload", function () {
    if (faceCameraStream) {
        faceCameraStream.getTracks().forEach(track => track.stop());
    }
});

function clearAttendance() {
    alert(
        "Attendance clearing is not connected to the database yet. " +
        "No records have been deleted."
    );
}

const enrollmentStudent = document.getElementById("enrollmentStudent");
const enrollmentVideo = document.getElementById("enrollmentVideo");
const enrollmentStatus = document.getElementById("enrollmentStatus");
const startEnrollmentCameraButton = document.getElementById("startEnrollmentCamera");
const enrollFaceButton = document.getElementById("enrollFaceButton");
const stopEnrollmentCameraButton = document.getElementById("stopEnrollmentCamera");

let enrollmentStream = null;
let enrollmentModelsLoaded = false;
let enrollmentBusy = false;

async function loadEnrollmentModels() {
    if (enrollmentModelsLoaded) return;

    if (typeof faceapi === "undefined") {
        throw new Error("The face-api.js library did not load.");
    }

    enrollmentStatus.textContent = "Loading face recognition models...";

    await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri("/models/tiny_face_detector"),
        faceapi.nets.faceLandmark68Net.loadFromUri("/models/face_landmark_68"),
        faceapi.nets.faceRecognitionNet.loadFromUri("/models/face_recognition")
    ]);

    enrollmentModelsLoaded = true;
}

async function loadEnrollmentStudents() {
    if (!enrollmentStudent) return;

    enrollmentStudent.replaceChildren();

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Loading students...";
    enrollmentStudent.appendChild(placeholder);

    try {
        const response = await fetch("/api/students");

        if (!response.ok) {
            throw new Error("Could not load registered students.");
        }

        const students = await response.json();
        enrollmentStudent.replaceChildren();

        const firstOption = document.createElement("option");
        firstOption.value = "";
        firstOption.textContent = "Select a student";
        enrollmentStudent.appendChild(firstOption);

        students.forEach(student => {
            const option = document.createElement("option");
            option.value = String(student.id);
            option.textContent =
                student.studentId + " — " + student.studentName;
            enrollmentStudent.appendChild(option);
        });

        if (students.length === 0) {
            enrollmentStatus.textContent =
                "No registered students found. Add a student first.";
        } else {
            enrollmentStatus.textContent =
                "Select a consenting participant, then start the camera.";
        }
    } catch (error) {
        console.error("Enrollment student loading error:", error);
        enrollmentStudent.replaceChildren();

        const option = document.createElement("option");
        option.value = "";
        option.textContent = "Could not load students";
        enrollmentStudent.appendChild(option);

        enrollmentStatus.textContent =
            "Could not load students. Check the server connection.";
    }
}

async function startEnrollmentCamera() {
    if (!enrollmentVideo || enrollmentBusy) return;

    if (enrollmentStream) {
        enrollmentStatus.textContent = "Enrollment camera is already running.";
        return;
    }

    try {
        enrollmentBusy = true;
        startEnrollmentCameraButton.disabled = true;

        await loadEnrollmentModels();

        enrollmentStatus.textContent = "Requesting camera permission...";

        enrollmentStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false
        });

        enrollmentVideo.srcObject = enrollmentStream;
        await enrollmentVideo.play();

        if (enrollmentVideo.readyState < 2) {
            await new Promise(resolve => {
                enrollmentVideo.addEventListener("loadeddata", resolve, {
                    once: true
                });
            });
        }

        enrollFaceButton.disabled = false;
        enrollmentStatus.textContent =
            "Camera ready. Make sure only the consenting participant is in view.";
    } catch (error) {
        console.error("Enrollment camera error:", error);

        stopEnrollmentCamera();

        if (enrollmentStatus) {
            enrollmentStatus.textContent =
                error.name === "NotAllowedError"
                    ? "Camera permission denied. Allow camera access in your browser."
                    : "Could not start enrollment camera. Check the camera and model files.";
        }
    } finally {
        enrollmentBusy = false;
        startEnrollmentCameraButton.disabled = false;
    }
}

async function enrollSelectedFace() {
    if (enrollmentBusy) return;

    const studentDatabaseId = enrollmentStudent?.value;

    if (!studentDatabaseId) {
        enrollmentStatus.textContent = "Please select a registered student first.";
        return;
    }

    if (
        !enrollmentStream ||
        !enrollmentVideo ||
        enrollmentVideo.readyState < 2
    ) {
        enrollmentStatus.textContent = "Start the camera before enrolling a face.";
        return;
    }

    if (!confirm(
        "Confirm that this participant has agreed to face enrollment. " +
        "Enroll only the selected participant."
    )) {
        return;
    }

    try {
        enrollmentBusy = true;
        enrollFaceButton.disabled = true;
        enrollmentStatus.textContent = "Checking for one clear face...";

        const results = await faceapi
            .detectAllFaces(
                enrollmentVideo,
                new faceapi.TinyFaceDetectorOptions()
            )
            .withFaceLandmarks()
            .withFaceDescriptors();

        if (results.length !== 1) {
            enrollmentStatus.textContent =
                results.length === 0
                    ? "No face detected. Adjust the camera and try again."
                    : "More than one face detected. Ensure only the participant is visible and try again.";
            return;
        }

        const descriptor = Array.from(results[0].descriptor);

        if (
            descriptor.length !== 128 ||
            !descriptor.every(Number.isFinite)
        ) {
            throw new Error("The face descriptor was invalid. Please try again.");
        }

        enrollmentStatus.textContent = "Saving enrollment to the database...";

        const response = await fetch(
            "/api/students/" +
                encodeURIComponent(studentDatabaseId) +
                "/face-enrollment",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ descriptor })
            }
        );

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || "Could not save face enrollment.");
        }

        enrollmentStatus.textContent =
            "Face enrollment saved for the selected student.";
    } catch (error) {
        console.error("Face enrollment error:", error);
        enrollmentStatus.textContent = error.message ||
            "Enrollment failed. Check the server and try again.";
    } finally {
        enrollmentBusy = false;
        enrollFaceButton.disabled = !enrollmentStream;
    }
}

function stopEnrollmentCamera() {
    if (enrollmentStream) {
        enrollmentStream.getTracks().forEach(track => track.stop());
        enrollmentStream = null;
    }

    if (enrollmentVideo) {
        enrollmentVideo.pause();
        enrollmentVideo.srcObject = null;
    }

    if (enrollFaceButton) {
        enrollFaceButton.disabled = true;
    }

    if (enrollmentStatus) {
        enrollmentStatus.textContent = "Enrollment camera stopped.";
    }
}

if (enrollmentStudent) {
    loadEnrollmentStudents();
}

if (startEnrollmentCameraButton) {
    startEnrollmentCameraButton.addEventListener(
        "click",
        startEnrollmentCamera
    );
}

if (enrollFaceButton) {
    enrollFaceButton.addEventListener("click", enrollSelectedFace);
}

if (stopEnrollmentCameraButton) {
    stopEnrollmentCameraButton.addEventListener(
        "click",
        stopEnrollmentCamera
    );
}

window.addEventListener("beforeunload", stopEnrollmentCamera);
