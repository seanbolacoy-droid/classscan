
function updateDateTime() {
    const now = new Date();

    const dateElement = document.getElementById("currentDate");
    const timeElement = document.getElementById("currentTime");

    if (dateElement) {
        const dateOptions = {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric"
        };

        dateElement.textContent =
            now.toLocaleDateString("en-US", dateOptions);
    }

    if (timeElement) {
        const timeOptions = {
            hour: "numeric",
            minute: "2-digit",
            second: "2-digit",
            hour12: true
        };

        timeElement.textContent =
            now.toLocaleTimeString("en-US", timeOptions);
    }
}

updateDateTime();
setInterval(updateDateTime, 1000);


const registerForm = document.getElementById("registerForm");

if (registerForm) {
    registerForm.addEventListener("submit", function(event) {
        event.preventDefault();

        const fullName =
            document.getElementById("fullName").value.trim();

        const username =
            document.getElementById("registerUsername").value.trim();

        const email =
            document.getElementById("registerEmail").value.trim();

        const password =
            document.getElementById("registerPassword").value;

        const confirmPassword =
            document.getElementById("confirmPassword").value;

        const message =
            document.getElementById("registerMessage");

        if (password !== confirmPassword) {
            message.textContent = "Passwords do not match.";
            return;
        }

        const newUser = {
            fullName,
            username,
            email,
            password
        };

        localStorage.setItem(
            "classScanUser",
            JSON.stringify(newUser)
        );

        message.textContent = "Account created successfully!";

        setTimeout(function() {
            window.location.href = "login.html";
        }, 1000);
    });
}


const loginForm = document.getElementById("loginForm");

if (loginForm) {
    loginForm.addEventListener("submit", function(event) {
        event.preventDefault();

        const username =
            document.getElementById("loginUsername").value.trim();

        const password =
            document.getElementById("loginPassword").value;

        const message =
            document.getElementById("loginMessage");

        const savedUser = localStorage.getItem("classScanUser");

        if (!savedUser) {
            message.textContent =
                "No account found. Please create an account first.";
            return;
        }

        const user = JSON.parse(savedUser);

        if (
            username === user.username &&
            password === user.password
        ) {
            message.textContent = "Login successful!";

            localStorage.setItem("classScanLoggedIn", "true");

            setTimeout(function() {
                window.location.href = "website.html";
            }, 700);
        } else {
            message.textContent = "Incorrect username or password.";
        }
    });
}


function logout() {
    const confirmLogout =
        confirm("Are you sure you want to log out?");

    if (confirmLogout) {
        localStorage.removeItem("classScanLoggedIn");
        window.location.href = "login.html";
    }
}


function startScan() {
    alert(
        "📷 ClassScan Face Scanner\n\n" +
        "The camera and facial recognition system " +
        "will be connected here later."
    );
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

        deleteButton.addEventListener("click", function() {
            deleteStudent(student.id, student.studentName);
        });

        actionCell.appendChild(deleteButton);
        row.appendChild(actionCell);
        studentTable.appendChild(row);
    });
}


if (studentForm) {
    studentForm.addEventListener("submit", async function(event) {
        event.preventDefault();

        const studentId =
            document.getElementById("studentId").value.trim();

        const studentName =
            document.getElementById("studentName").value.trim();

        const section =
            document.getElementById("studentSection").value.trim();

        const message =
            document.getElementById("studentMessage");

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
                throw new Error(
                    result.message || "Failed to add student."
                );
            }

            if (message) {
                message.textContent = "Student added successfully!";
            }

            studentForm.reset();
            await showStudents();
        } catch (error) {
            if (message) {
                message.textContent = error.message;
            }

            console.error("Add student error:", error);
        }
    });
}


async function deleteStudent(id, studentName) {
    const confirmed = confirm(
        "Are you sure you want to delete " + studentName + "?"
    );

    if (!confirmed) return;

    try {
        const response = await fetch(
            "/api/students/" + encodeURIComponent(id),
            { method: "DELETE" }
        );

        const result = await response.json();

        if (!response.ok) {
            throw new Error(
                result.message || "Failed to delete student."
            );
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
    const user = JSON.parse(savedUser);

    const profileName = document.getElementById("profileName");
    const profileUsername = document.getElementById("profileUsername");
    const profileIcon = document.getElementById("profileIcon");

    if (profileName) {
        profileName.textContent = user.fullName;
    }

    if (profileUsername) {
        profileUsername.textContent = "@" + user.username;
    }

    if (profileIcon) {
        profileIcon.textContent =
            user.fullName.charAt(0).toUpperCase();
    }
}
