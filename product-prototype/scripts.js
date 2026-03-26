// --- STATE MANAGEMENT ---
const state = {
  userId: 'user_12345',
  currentView: 'login',
  isDarkMode: false,
  uiProfile: 'default', 
  fileContents: {}
};

// --- FIREBASE SETUP ---
const firebaseConfig = {
    apiKey: "AIzaSyBCFRvUOe-A7fipHLhbciVGo8wlwbwaEQE",
    authDomain: "neurolearn-c6187.firebaseapp.com",
    projectId: "neurolearn-c6187",
    storageBucket: "neurolearn-c6187.firebasestorage.app",
    messagingSenderId: "1008563636197",
    appId: "1:1008563636197:web:1c76b205a50000f36bd10c",
    measurementId: "G-PWNPPHWTQ7"
  };

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

// --- AUTHENTICATION LISTENER ---
// This watches for changes in the user's login status globally
auth.onAuthStateChanged((user) => {
  if (user) {
    // User is signed in.
    state.userId = user.uid;
  } else {
    // User is signed out. Force them to the login screen if they aren't already there or on signup.
    state.userId = null;
    if (state.currentView !== 'login' && state.currentView !== 'signup') {
      navigate('login');
    }
  }
});

// --- PDF.JS SETUP ---
if (window['pdfjs-dist/build/pdf']) {
  window.pdfjsLib = window['pdfjs-dist/build/pdf'];
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

async function extractTextFromPDF(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
    let fullText = "";
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += pageText + "\n\n";
    }
    return fullText;
  } catch (error) {
    console.error("PDF Parsing Error:", error);
    throw new Error("Could not parse this PDF.");
  }
}

// --- NAVIGATION ---
function navigate(viewId) {
  document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
  document.getElementById(`view-${viewId}`).classList.add('active');
  
  const sidebar = document.getElementById('main-nav');
  if (['login', 'signup', 'tutorial', 'analyzing'].includes(viewId)) {
    sidebar.classList.add('hidden');
  } else {
    sidebar.classList.remove('hidden');
  }
  state.currentView = viewId;
}

async function handleLogin() {
  const email = document.getElementById('email-input').value;
  const password = document.getElementById('password-input').value;
  const errorDiv = document.getElementById('login-error');

  errorDiv.classList.add('hidden'); 

  try {
    const userCredential = await auth.signInWithEmailAndPassword(email, password);
    state.userId = userCredential.user.uid; 

    // NEW: Check Firestore for an existing user profile
    const userDoc = await db.collection("users").doc(state.userId).get();

    if (userDoc.exists && userDoc.data().uiProfile) {
      // User has been here before! Apply their saved profile and skip the tutorial.
      console.log("Welcome back. Loading profile:", userDoc.data().uiProfile);
      applyUIConfig(userDoc.data().uiProfile);
      navigate('dashboard');
    } else {
      // First time logging in, or profile missing. Run the calibration tutorial.
      console.log("No profile found. Starting calibration...");
      navigate('tutorial');
      startTelemetry();
    }
    
  } catch (error) {
    console.error("Login Error:", error.code, error.message);
    
    if (error.code === 'auth/invalid-credential') {
      errorDiv.innerHTML = '<i class="ph ph-warning-circle"></i> Invalid email or password.';
    } else {
      errorDiv.innerHTML = '<i class="ph ph-warning-circle"></i> Login failed. Please try again.';
    }
    errorDiv.classList.remove('hidden');
  }
}

async function handleSignup() {
  const email = document.getElementById('signup-email').value;
  const password = document.getElementById('signup-password').value;
  const errorDiv = document.getElementById('signup-error');

  // Hide previous errors
  errorDiv.classList.add('hidden');

  try {
    // 1. Create the user in Firebase Auth
    const userCredential = await auth.createUserWithEmailAndPassword(email, password);
    
    // 2. Assign the secure UID to your local state
    state.userId = userCredential.user.uid;

    // 3. Clear the form for security
    document.getElementById('signup-form').reset();

    // 4. Move them directly into the onboarding tutorial
    navigate('tutorial');
    startTelemetry();

  } catch (error) {
    console.error("Signup Error:", error.code, error.message);
    
    // Display human-readable errors based on Firebase error codes
    if (error.code === 'auth/email-already-in-use') {
      errorDiv.innerHTML = '<i class="ph ph-warning-circle"></i> This email is already registered. Please log in.';
    } else if (error.code === 'auth/weak-password') {
      errorDiv.innerHTML = '<i class="ph ph-warning-circle"></i> Password is too weak. Please use at least 6 characters.';
    } else {
      errorDiv.innerHTML = '<i class="ph ph-warning-circle"></i> Failed to create account. Please try again.';
    }
    
    errorDiv.classList.remove('hidden');
  }
}

async function handleSignOut() {
  try {
    // 1. Tell Firebase to end the active session
    await auth.signOut();
    
    // 2. Clear the user ID from your local state
    state.userId = null;
    
    // 3. Reset the UI profile to default (prevents theme bleeding)
    applyUIConfig('default');
    
    // 4. Return the user to the login screen
    navigate('login');
    
    // Optional: Clear any secure form fields just in case
    document.getElementById('login-form').reset();
    
    console.log("User successfully signed out.");
  } catch (error) {
    console.error("Sign Out Error:", error.message);
    alert("There was a problem signing out. Please try again.");
  }
}

// --- TELEMETRY ENGINE (PHASE 1) ---
const TelemetryTracker = {
  startTime: 0,
  firstClickTime: null,
  mousePositions: [],
  lastScrollTop: 0,
  scrollDirection: null,
  
  metrics: {
    time_to_first_click: 0, task_completion_time: 0, mouse_velocity_avg: 0,
    cursor_straightness: 1.0, scroll_reversals: 0, repetitive_clicks: 0,
    back_button_usage: 0, text_dwell_time: 0
  },

  dwellTimers: {}, lastClickTarget: null, lastClickTime: 0,

  start() {
    this.startTime = performance.now();
    this.bindEvents();
  },

  bindEvents() {
    const zone = document.querySelector('.telemetry-zone');
    if (!zone) return;
    zone.addEventListener('mousedown', this.onMouseDown.bind(this));
    zone.addEventListener('mousemove', this.onMouseMove.bind(this));
    window.addEventListener('scroll', this.onScroll.bind(this));
    
    document.querySelectorAll('.track-back-btn').forEach(btn => {
      btn.addEventListener('click', () => this.metrics.back_button_usage++);
    });
    document.querySelectorAll('.track-dwell').forEach(el => {
      el.addEventListener('mouseenter', (e) => this.startDwell(e.target.dataset.dwellId));
      el.addEventListener('mouseleave', (e) => this.stopDwell(e.target.dataset.dwellId));
    });
  },

  onMouseDown(e) {
    const now = performance.now();
    if (!this.firstClickTime) {
      this.firstClickTime = now;
      this.metrics.time_to_first_click = (this.firstClickTime - this.startTime) / 1000;
    }
    if (this.lastClickTarget === e.target && (now - this.lastClickTime) < 500) {
      this.metrics.repetitive_clicks++;
    }
    this.lastClickTarget = e.target;
    this.lastClickTime = now;
  },

  onMouseMove(e) {
    if (this.mousePositions.length % 5 === 0 || this.mousePositions.length < 2) {
      this.mousePositions.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    }
  },

  onScroll() {
    const st = window.pageYOffset || document.documentElement.scrollTop;
    const currentDir = st > this.lastScrollTop ? 'down' : 'up';
    if (this.scrollDirection && this.scrollDirection !== currentDir && Math.abs(st - this.lastScrollTop) > 10) {
      this.metrics.scroll_reversals++;
    }
    this.scrollDirection = currentDir;
    this.lastScrollTop = st <= 0 ? 0 : st;
  },

  startDwell(id) { this.dwellTimers[id] = performance.now(); },
  stopDwell(id) {
    if (this.dwellTimers[id]) {
      const duration = (performance.now() - this.dwellTimers[id]) / 1000;
      this.metrics.text_dwell_time += duration;
    }
  },

  calculateFinalMetrics() {
    this.metrics.task_completion_time = (performance.now() - this.startTime) / 1000;
    Object.keys(this.metrics).forEach(key => {
      if (typeof this.metrics[key] === 'number' && !Number.isInteger(this.metrics[key])) {
        this.metrics[key] = parseFloat(this.metrics[key].toFixed(2));
      }
    });
    return this.metrics;
  }
};

function startTelemetry() { TelemetryTracker.start(); }

async function finishTutorial() {
  const finalMetrics = TelemetryTracker.calculateFinalMetrics();
  const payload = { userId: state.userId, telemetry: finalMetrics };

  navigate('analyzing');
  document.getElementById('json-payload-display').textContent = JSON.stringify(payload, null, 2);

  setTimeout(() => {
    const profiles = ['default', 'aphasia', 'memory', 'autism', 'dementia', 'impairment'];
    const determinedProfile = profiles[Math.floor(Math.random() * profiles.length)]; 
    
    const logDisplay = document.getElementById('telemetry-log-display');
    logDisplay.textContent = `AI Sync Complete. Profile selected: ${determinedProfile}`;
    logDisplay.classList.add('text-success');

    // NEW: Save the generated profile to Firestore
    if (state.userId) {
      db.collection("users").doc(state.userId).set({
        uiProfile: determinedProfile,
        lastCalibrated: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true })
      .then(() => console.log("User profile securely saved to database."))
      .catch((error) => console.error("Error saving profile: ", error));
    }

    setTimeout(() => {
      applyUIConfig(determinedProfile);
      navigate('dashboard');
    }, 1000);

  }, 1500);
}

function applyUIConfig(profileName) {
  state.uiProfile = profileName;
  document.body.className = '';
  document.body.classList.add(`profile-${profileName}`);
  
  if (profileName === 'impairment' || profileName === 'aphasia') {
    document.body.classList.add('theme-confusion');
  }
  if (profileName === 'impairment') {
    document.getElementById('chunk-2').classList.add('locked');
  }
}

// --- RESOURCE UPLOAD LOGIC ---
const dropZone = document.getElementById('drop-zone');

['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
  dropZone.addEventListener(eventName, preventDefaults, false);
});

function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

['dragenter', 'dragover'].forEach(eventName => {
  dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
});

['dragleave', 'drop'].forEach(eventName => {
  dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
});

dropZone.addEventListener('drop', (e) => handleFileUpload(e.dataTransfer.files));

async function handleFileUpload(files) {
  if (files.length > 0) {
    const file = files[0];
    const feedbackEl = document.getElementById('upload-feedback');
    
    feedbackEl.innerHTML = `<i class="ph ph-spinner-gap animate-spin"></i> Reading ${file.name}...`;
    feedbackEl.className = 'text-sm font-medium text-primary block';

    try {
      let extractedText = "";
      if (file.name.toLowerCase().endsWith('.txt')) {
        extractedText = await file.text();
      } else if (file.name.toLowerCase().endsWith('.pdf')) {
        extractedText = await extractTextFromPDF(file);
      } else {
        throw new Error("Unsupported format.");
      }

      if (!extractedText.trim()) throw new Error("No readable text found.");

      state.fileContents[file.name] = extractedText;

      feedbackEl.innerHTML = `<i class="ph ph-check-circle"></i> Successfully processed: ${file.name}`;
      feedbackEl.className = 'text-sm font-medium text-success block';
      
      addFileToList(file);
      setTimeout(() => { feedbackEl.classList.add('hidden'); }, 3000);

    } catch (error) {
      feedbackEl.innerHTML = `<i class="ph ph-warning-circle"></i> Error: ${error.message}`;
      feedbackEl.className = 'text-sm font-medium text-attention block';
    }
  }
}

function addFileToList(file) {
  const list = document.getElementById('uploaded-files-list');
  const fileId = 'file-' + Date.now();
  
  const fileCard = document.createElement('div');
  fileCard.className = 'file-item';
  fileCard.id = fileId;
  
  fileCard.innerHTML = `
    <div class="flex items-center gap-1" style="overflow: hidden;">
      <div class="file-icon-box">
        <i class="ph ph-file-pdf"></i>
      </div>
      <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px;">
        <h3 class="text-sm" style="margin:0; text-overflow: ellipsis; overflow: hidden;" title="${file.name}">${file.name}</h3>
        <span class="text-xs text-muted">${(file.size / 1024).toFixed(1)} KB • AI Ready</span>
      </div>
    </div>
    <div class="flex gap-1" style="flex-shrink: 0;">
      <button onclick="generateLesson('${file.name}')" class="btn-primary" style="padding: 6px 10px; font-size: 12px; background-color: var(--color-secondary);">
        <i class="ph ph-magic-wand"></i> <span>Learn</span>
      </button>
      <button onclick="document.getElementById('${fileId}').remove()" class="btn-icon danger">
        <i class="ph ph-trash"></i>
      </button>
    </div>
  `;
  list.prepend(fileCard);
}

async function generateLesson(filename) {
  const canvasContainer = document.querySelector('#view-canvas .max-w-prose');
  const header = document.querySelector('#view-canvas h1');
  
  navigate('canvas');
  header.innerHTML = `Generating Lesson... <i class="ph ph-spinner-gap animate-spin text-primary"></i>`;
  canvasContainer.innerHTML = `<p class="text-muted">Sending document to AI and adapting to your <b>${state.uiProfile}</b> profile...</p>`;

  try {
    const documentText = state.fileContents[filename];
    if (!documentText) throw new Error("Text not found.");
    
    // 1. Get the current user's secure token
    const currentUser = firebase.auth().currentUser;
    if (!currentUser) throw new Error("You must be logged in to generate lessons.");
    const idToken = await currentUser.getIdToken();

    // 2. Make the actual fetch request to your backend
    // Replace the URL with your actual backend endpoint (e.g., your Python server)
    const response = await fetch('http://localhost:5000/api/generate-lesson', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}` // Secures your endpoint
      },
      body: JSON.stringify({
        filename: filename,
        text: documentText,
        profile: state.uiProfile // Tell the AI how to format the output
      })
    });

    if (!response.ok) {
      throw new Error(`Server responded with status: ${response.status}`);
    }

    // 3. Expecting a structured JSON response back from your AI
    const lessonData = await response.json();
    
    // 4. Render the returned JSON into the UI
    header.innerHTML = lessonData.title || `Lesson: ${filename}`;
    
    // Clear the loading message
    canvasContainer.innerHTML = ''; 

    // Dynamically build the lesson chunks based on the AI's JSON output
    if (lessonData.chunks && Array.isArray(lessonData.chunks)) {
      lessonData.chunks.forEach((chunk, index) => {
        const isFirst = index === 0;
        const chunkHtml = `
          <div class="card chunk ${isFirst ? '' : 'locked'}" id="chunk-${index + 1}">
            <h3><i class="ph ph-buildings aphasia-icon"></i> ${chunk.heading}</h3>
            <div style="margin: 12px 0;">
               ${chunk.content}
            </div>
            ${chunk.example ? `
            <div class="ai-tint card-sm" style="border-radius: 4px;">
                <p class="text-sm" style="margin: 0;"><strong>Example:</strong> ${chunk.example}</p>
            </div>` : ''}
            
            ${index < lessonData.chunks.length - 1 ? `
            <button class="btn-primary chunk-btn" onclick="unlockChunk(${index + 2}, this)">
              Next Concept <i class="ph ph-arrow-down"></i>
            </button>` : `<p class="text-success font-medium mt-10"><i class="ph ph-check-circle"></i> Lesson Complete</p>`}
          </div>
        `;
        canvasContainer.insertAdjacentHTML('beforeend', chunkHtml);
      });
    } else {
       canvasContainer.innerHTML = `<p>Lesson generated, but format was unexpected.</p>`;
    }

  } catch (error) {
    console.error("API Error:", error);
    header.innerText = "Error Generating Lesson";
    canvasContainer.innerHTML = `<p style="color: #ef4444;">Could not connect to the backend or process the document. Error: ${error.message}</p>`;
  }
}

function unlockChunk(id, btnElement) {
  const chunk = document.getElementById(`chunk-${id}`);
  if (chunk) {
    chunk.classList.remove('locked');
    if (btnElement) btnElement.style.display = 'none';
    chunk.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// --- DARK MODE LOGIC ---
function toggleDarkMode() {
  state.isDarkMode = !state.isDarkMode;
  const toggleBg = document.getElementById('toggle-dark');

  if (state.isDarkMode) {
    document.documentElement.classList.add('dark');
    toggleBg.classList.add('active');
  } else {
    document.documentElement.classList.remove('dark');
    toggleBg.classList.remove('active');
  }
}

if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
  toggleDarkMode();
}