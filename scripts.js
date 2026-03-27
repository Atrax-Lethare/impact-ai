// --- STATE MANAGEMENT ---
const savedUserId = localStorage.getItem('neuroLearn_userId');
const savedProfile = localStorage.getItem('neuroLearn_profile') || 'default';
const savedSessions = JSON.parse(localStorage.getItem('neuroLearn_sessions')) || [];
// NEW: Fetch saved pins for the memory profile
const savedPins = JSON.parse(localStorage.getItem('neuroLearn_pins')) || [];

const state = {
    userId: savedUserId,
    currentView: savedUserId ? 'dashboard' : 'login',
    isDarkMode: false,
    uiProfile: savedProfile,
    sessions: savedSessions,
    activeLesson: null,
    pinnedFacts: savedPins,
    fileContents: {}
};

// --- INITIAL APP LOAD ---
document.addEventListener("DOMContentLoaded", () => {
    applyUIConfig(state.uiProfile);
    renderDashboardSessions();
    renderPinnedFacts(); // NEW: Render pins on load
    navigate(state.currentView);
});

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
const db = firebase.firestore();

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
    const mobileHeader = document.getElementById('mobile-header');
    
    // Hide sidebar and mobile header on auth/calibration screens
    if (['login', 'signup', 'tutorial', 'analyzing'].includes(viewId)) {
        sidebar.classList.add('hidden');
        if (mobileHeader) mobileHeader.classList.add('hidden');
    } else {
        sidebar.classList.remove('hidden');
        if (mobileHeader) mobileHeader.classList.remove('hidden');
    }
    
    // Auto-close mobile menu if it's open when navigating
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar.classList.contains('mobile-open')) {
        sidebar.classList.remove('mobile-open');
        if (overlay) overlay.classList.remove('active');
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

    // Check Firestore for an existing user profile
    const userDoc = await db.collection("users").doc(state.userId).get();

    if (userDoc.exists) {
      const data = userDoc.data();
      
      // Load UI Profile
      if (data.uiProfile) {
          state.uiProfile = data.uiProfile;
          localStorage.setItem('neuroLearn_profile', data.uiProfile);
          applyUIConfig(data.uiProfile);
      }
      
      // NEW: Load their last active lesson from the cloud
      if (data.activeLesson) {
          state.activeLesson = data.activeLesson;
          localStorage.setItem('neuroLearn_activeLesson', data.activeLesson);
          
          const dashboardTitle = document.getElementById('dashboard-active-lesson');
          if (dashboardTitle) dashboardTitle.textContent = data.activeLesson;
      }

      if (data.sessions) {
          state.sessions = data.sessions;
          localStorage.setItem('neuroLearn_sessions', JSON.stringify(data.sessions));
      }

      renderDashboardSessions();
      console.log("Welcome back. Profile loaded.");
      
      localStorage.setItem('neuroLearn_userId', state.userId);
      initializeUserStats();
      navigate('dashboard');
    } else {
      // First time logging in. Run the calibration tutorial.
      console.log("No profile found. Starting calibration...");
      navigate('tutorial');
      startTelemetry();
    }
    
  } catch (error) {
    console.error("Login Error:", error.code, error.message);
    
    if (state.uiProfile === 'autism') {
        // Highly specific, constructive feedback
        errorDiv.innerHTML = '<strong>Action Required:</strong> The email or password entered does not match the database. <br>1. Check that the Caps Lock key is turned off.<br>2. Verify the spelling of your email.<br>3. Delete the password and type it again slowly.';
    } else if (error.code === 'auth/invalid-credential') {
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
    
    if (state.uiProfile === 'autism') {
        if (error.code === 'auth/weak-password') {
            errorDiv.innerHTML = '<strong>Error:</strong> The password entered has fewer than 6 characters. <br><strong>Fix:</strong> Click the password box and type additional characters until there are at least 6.';
        } else if (error.code === 'auth/email-already-in-use') {
            errorDiv.innerHTML = '<strong>Error:</strong> This email address is already in the database. <br><strong>Fix:</strong> Click the "Already have an account? Log in" button below to input your password.';
        } else {
            errorDiv.innerHTML = 'System error preventing account creation. Please refresh the page and input the data again.';
        }
    } else {
        // ... (Keep your existing default error checks here)
    }
    errorDiv.classList.remove('hidden');
  }
}

async function handleSignOut() {
  try {
    await auth.signOut();
    state.userId = null;
    
    // NEW: Wipe the local storage clean
    localStorage.removeItem('neuroLearn_userId');
    localStorage.removeItem('neuroLearn_profile');
    localStorage.removeItem('neuroLearn_sessions');
    state.sessions = [];
    if (learningTimerInterval) clearInterval(learningTimerInterval);
    
    applyUIConfig('default');
    navigate('login');
    document.getElementById('login-form').reset();
    closeProfileModal(); // Make sure the modal closes if it was open
    
    console.log("User successfully signed out.");
  } catch (error) {
    console.error("Sign Out Error:", error.message);
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

    try {
        // Now 'await' will work perfectly!
        const response = await fetch('http://127.0.0.1:8000/predict-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        const determinedProfile = data.predicted_profile; 

        const logDisplay = document.getElementById('telemetry-log-display');
        logDisplay.textContent = `AI Sync Complete. Profile selected: ${determinedProfile}`;
        logDisplay.classList.add('text-success');

        // ... the rest of your saving logic ...

        setTimeout(() => {
            applyUIConfig(determinedProfile);
            navigate('dashboard');
            initializeUserStats();
        }, 1000);

    } catch (error) {
        console.error("Calibration Error:", error);
        document.getElementById('telemetry-log-display').textContent = "Connection error. Using default profile.";
        applyUIConfig('default');
        navigate('dashboard');
    }
}

function applyUIConfig(profileName) {
    state.uiProfile = profileName;
    document.body.className = '';
    
    // Apply Base Dark mode if active
    if (state.isDarkMode) document.documentElement.classList.add('dark');
    
    // Apply the active profile class to the body
    document.body.classList.add(`profile-${profileName}`);

    // --- DYNAMIC TEXT SWAPPING ---
    const navDashboard = document.getElementById('nav-btn-dashboard');
    const navCanvas = document.getElementById('nav-btn-canvas');
    const loginHeader = document.getElementById('login-header');
    const loginBtn = document.getElementById('btn-login-text');

    if (profileName === 'dementia') {
        // Active Voice & Direct Instructions
        if(navDashboard) navDashboard.innerHTML = `<i class="ph ph-squares-four text-lg"></i> <span>Go to the Home Page</span>`;
        if(navCanvas) navCanvas.innerHTML = `<i class="ph ph-book-open text-lg"></i> <span>Read Your Current Lesson</span>`;
        if(navResources) navResources.innerHTML = `<i class="ph ph-folder text-lg"></i> <span>Upload New Documents</span>`;
        if(loginHeader) loginHeader.innerText = "Access Your Account";
        if(loginBtn) loginBtn.innerText = "Click Here to Log In";
    } else if (profileName === 'aphasia') {
        // Plain Language & Syntax (Multi-modal pairs)
        if(navDashboard) navDashboard.innerHTML = `<i class="ph ph-house text-lg"></i> <span>Home</span>`;
        if(navCanvas) navCanvas.innerHTML = `<i class="ph ph-book-open text-lg"></i> <span>Learn</span>`;
        if(navResources) navResources.innerHTML = `<i class="ph ph-folder text-lg"></i> <span>Files</span>`;
        
        if(loginHeader) loginHeader.innerText = "Sign In";
        if(loginBtn) loginBtn.innerHTML = `<i class="ph ph-sign-in"></i> <span>Enter</span>`;
    } else if (profileName === 'autism') {
        // Literal, non-abstract navigation labels
        if(navDashboard) navDashboard.innerHTML = `<i class="ph ph-squares-four text-lg"></i> <span>Index of Modules</span>`;
        if(navCanvas) navCanvas.innerHTML = `<i class="ph ph-book-open text-lg"></i> <span>Active Study Area</span>`;
        if(navResources) navResources.innerHTML = `<i class="ph ph-folder text-lg"></i> <span>Document Storage</span>`;
        if(loginHeader) loginHeader.innerText = "System Login";
        if(loginBtn) loginBtn.innerText = "Submit Credentials";
        
        // Turn on strict sensory mode by default when profile is loaded
        document.body.classList.add('strict-sensory');
    } else if (profileName === 'memory') {
        if(navDashboard) navDashboard.innerHTML = `<i class="ph ph-squares-four text-lg"></i> <span>Dashboard (Home)</span>`;
        if(navCanvas) navCanvas.innerHTML = `<i class="ph ph-book-open text-lg"></i> <span>Current Lesson</span>`;
        if(loginHeader) loginHeader.innerText = "Welcome Back - Please Log In"; 
    } else if (profileName === 'impairment') {
        // Decluttered, straightforward labeling
        if(navDashboard) navDashboard.innerHTML = `<i class="ph ph-squares-four text-lg"></i> <span>Dashboard</span>`;
        if(navCanvas) navCanvas.innerHTML = `<i class="ph ph-book-open text-lg"></i> <span>Lesson Area</span>`;
        if(navResources) navResources.innerHTML = `<i class="ph ph-folder text-lg"></i> <span>My Files</span>`;
        if(loginHeader) loginHeader.innerText = "Log In";
        if(loginBtn) loginBtn.innerText = "Continue";
    } else {
        // Reset to Default
        if(navDashboard) navDashboard.innerHTML = `<i class="ph ph-squares-four text-lg"></i> <span>Dashboard</span>`;
        if(navCanvas) navCanvas.innerHTML = `<i class="ph ph-book-open text-lg"></i> <span>Learning Canvas</span>`;
        if(navResources) navResources.innerHTML = `<i class="ph ph-folder text-lg"></i> <span>Resource Hub</span>`;
        if(loginHeader) loginHeader.innerText = "Log In";
        if(loginBtn) loginBtn.innerText = "Continue";
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

// --- DYNAMIC AI CANVAS RENDERING ---
async function generateLesson(filename) {
    const canvasContainer = document.getElementById('canvas-content-area');
    const breadcrumb = document.getElementById('breadcrumb-current');
    
    state.activeLesson = filename;
    if(breadcrumb) breadcrumb.innerText = filename;
    
    navigate('canvas');
    canvasContainer.innerHTML = `
        <div class="text-center mt-10" style="padding: 40px 0;">
            <i class="ph ph-spinner-gap animate-spin text-primary text-4xl mb-2 block mx-auto"></i>
            <h3 class="text-lg mt-2">AI is structuring your lesson...</h3>
        </div>
    `; 

    const rawText = state.fileContents[filename] || "";

    try {
        const response = await fetch('http://127.0.0.1:8000/generate-lesson', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source_material: rawText, // The whole PDF
                user_request: "Please introduce the first major concept from the source material to begin the lesson.", // The initial prompt
                ui_profile: state.uiProfile,
                severity_score: 5.0 
            })
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        
        canvasContainer.innerHTML = ''; 
        renderAIAsset({ content: data.asset_data.content });

    } catch (error) {
        console.error("Lesson Gen Error:", error);
        canvasContainer.innerHTML = `<p class="text-attention">Backend Connection Failed.</p>`;
    }
    updateMemoryInstructions("Read the introduction below. Click 'Pin' on any important facts to save them to your sidebar.");
}

function renderAIAsset(assetData) {
    const canvasContainer = document.getElementById('canvas-content-area');
    const assetId = `asset-${Date.now()}`;
    const savedDraft = state.uiProfile === 'memory' ? (localStorage.getItem(`neuroLearn_draft_${state.activeLesson}`) || '') : '';
    
    const chunkHtml = `
      <div class="card chunk" id="${assetId}" style="animation: fadeIn 0.5s ease;">
        <div class="ai-content-wrapper">
           ${assetData.content} 
        </div>
        
        <div class="feedback-toolbar" id="toolbar-${assetId}">
            <button class="btn-feedback" onclick="submitAIFeedback('${assetId}', 'understood')"><i class="ph ph-check-circle"></i> Understood</button>
            <button class="btn-feedback" onclick="submitAIFeedback('${assetId}', 'not_understood')"><i class="ph ph-warning-circle"></i> Not Understood</button>
            <button class="btn-feedback" onclick="submitAIFeedback('${assetId}', 'elaborate')"><i class="ph ph-arrows-out"></i> Elaborate</button>
            <button class="btn-feedback" onclick="submitAIFeedback('${assetId}', 'concise')"><i class="ph ph-arrows-in"></i> Concise</button>
            <button class="btn-feedback" onclick="toggleCustomMessage('${assetId}')"><i class="ph ph-chat-text"></i> Custom Msg</button>
        </div>

        
        
        <div class="custom-message-box" id="custom-msg-${assetId}">
            <div style="width: 100%;">
                <input type="text" id="input-${assetId}" 
                       value="${savedDraft}" 
                       oninput="saveMemoryDraft(this.value)" 
                       placeholder="Ask a question or request a format...">
                <div class="save-indicator memory-only" id="save-ind-${assetId}"><i class="ph ph-check"></i> Draft saved securely</div>
            </div>
            <button class="btn-primary" onclick="submitAIFeedback('${assetId}', 'custom')" style="align-self: flex-start;"><i class="ph ph-paper-plane-right"></i></button>
        </div>
      </div>
    `;
    
    canvasContainer.insertAdjacentHTML('beforeend', chunkHtml);
    
    // NEW: Tell Mermaid to render any new mind maps that were just injected
    try {
        if (window.mermaid) {
            mermaid.init(undefined, document.querySelectorAll('.mermaid'));
        }
    } catch (e) {
        console.error("Mermaid rendering error:", e);
    }
    
    setTimeout(() => {
        document.getElementById(assetId).scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
}

// UPDATED: Now accepts the specific filename to resume
function resumeLesson(filename) {
    const canvasContainer = document.getElementById('canvas-content-area');
    const canvasHeader = document.getElementById('canvas-lesson-title');

    const breadcrumb = document.getElementById('breadcrumb-current');
    if(breadcrumb) breadcrumb.innerText = filename;

    // NEW: If they are switching from one active lesson to a DIFFERENT one, 
    // clear the canvas so the previous lesson's chat doesn't bleed over.
    if (state.activeLesson !== filename && canvasContainer) {
        canvasContainer.innerHTML = '';
    }

    // Update the state to the new active lesson
    state.activeLesson = filename;
    localStorage.setItem('neuroLearn_activeLesson', filename);
    
    if (canvasHeader) canvasHeader.innerHTML = `Learning: ${filename}`;
    
    // If the canvas is empty, inject the "Welcome back" message
    if (!canvasContainer || !canvasContainer.innerHTML.trim()) {
        const resumeAsset = {
            content: `
                <h3>Welcome back to ${filename}.</h3>
                <p>Where would you like to pick up? I have your <b>${state.uiProfile}</b> preferences loaded and ready.</p>
            `
        };
        renderAIAsset(resumeAsset);
    }
    
    navigate('canvas');
}

function renderAIAsset(assetData) {
    const canvasContainer = document.getElementById('canvas-content-area');
    const assetId = `asset-${Date.now()}`;
    
    const chunkHtml = `
      <div class="card chunk" id="${assetId}" style="animation: fadeIn 0.5s ease;">
        <div class="ai-content-wrapper">
           ${assetData.content} 
        </div>
        
        <div class="feedback-toolbar" id="toolbar-${assetId}">
            <button class="btn-feedback aphasia-only" onclick="readSpecificChunk('${assetId}')" style="background: var(--color-bg-purple-light); color: var(--color-secondary); border-color: var(--color-secondary);">
                <i class="ph ph-speaker-high"></i> Listen
            </button>
            
            <button class="btn-feedback" onclick="submitAIFeedback('${assetId}', 'understood')"><i class="ph ph-check-circle"></i> Understood</button>
            <button class="btn-feedback" onclick="submitAIFeedback('${assetId}', 'not_understood')"><i class="ph ph-warning-circle"></i> Not Understood</button>
            <button class="btn-feedback" onclick="submitAIFeedback('${assetId}', 'elaborate')"><i class="ph ph-arrows-out"></i> Elaborate</button>
            <button class="btn-feedback" onclick="submitAIFeedback('${assetId}', 'concise')"><i class="ph ph-arrows-in"></i> Concise</button>
            <button class="btn-feedback" onclick="toggleCustomMessage('${assetId}')"><i class="ph ph-chat-text"></i> Custom Msg</button>
        </div>
        
        <div class="custom-message-box" id="custom-msg-${assetId}">
            <input type="text" id="input-${assetId}" placeholder="Ask a question or request a format (e.g., 'Make a mind map')...">
            <button class="btn-primary" onclick="submitAIFeedback('${assetId}', 'custom')"><i class="ph ph-paper-plane-right"></i></button>
        </div>
      </div>
    `;
    
    canvasContainer.insertAdjacentHTML('beforeend', chunkHtml);
    
    // DELAY THE RENDER: Give the browser 100ms to paint the HTML before triggering Mermaid
    setTimeout(() => {
        try {
            const newChunk = document.getElementById(assetId);
            const mermaidDivs = newChunk.querySelectorAll('.mermaid');
            
            if (mermaidDivs.length > 0 && window.mermaid) {
                // Initialize only the diagrams inside this new chunk
                mermaid.init(undefined, mermaidDivs);
            }
        } catch (e) {
            console.error("Mermaid rendering error:", e);
        }
        
        // Scroll to the new asset
        document.getElementById(assetId).scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
}

function toggleCustomMessage(assetId) {
    const box = document.getElementById(`custom-msg-${assetId}`);
    box.classList.toggle('active');
    if (box.classList.contains('active')) {
        document.getElementById(`input-${assetId}`).focus();
    }
}

// --- MOCK BACKEND CONNECTION ---
async function submitAIFeedback(assetId, action) {
    const toolbar = document.getElementById(`toolbar-${assetId}`);
    if (toolbar) {
        toolbar.style.opacity = '0.5';
        toolbar.style.pointerEvents = 'none';
    }
    
    const customMsgBox = document.getElementById(`custom-msg-${assetId}`);
    if (customMsgBox) customMsgBox.classList.remove('active');

    // 1. Better, highly specific prompts for the LLM
    let feedbackPrompt = "";
    if (action === 'understood') {
        feedbackPrompt = "I understood the previous concept. Based on the source material, teach me the NEXT logical concept.";
    } else if (action === 'not_understood') {
        feedbackPrompt = "I did not understand the last explanation. Please explain it again using a very simple, relatable real-world analogy.";
    } else if (action === 'elaborate') {
        feedbackPrompt = "Please elaborate on the current topic and provide more specific, granular details from the text.";
    } else if (action === 'concise') {
        feedbackPrompt = "Please summarize the core concepts of the source material into a brief, easy-to-read bulleted TL;DR.";
    } else if (action === 'custom') {
        const inputEl = document.getElementById(`input-${assetId}`);
        feedbackPrompt = inputEl ? inputEl.value : "";
        if (!feedbackPrompt.trim()) {
            if (toolbar) { toolbar.style.opacity = '1'; toolbar.style.pointerEvents = 'auto'; }
            return;
        }
        clearMemoryDraft();
    }

    // 2. We MUST grab the original document text so the AI doesn't forget it!
    const originalText = state.fileContents[state.activeLesson] || "";

    const canvasContainer = document.getElementById('canvas-content-area');
    const loaderId = `loader-${Date.now()}`;
    canvasContainer.insertAdjacentHTML('beforeend', `
        <div id="${loaderId}" class="text-center mt-10" style="padding: 20px 0;">
            <i class="ph ph-spinner-gap animate-spin text-primary text-3xl mb-2 block mx-auto"></i>
        </div>
    `);
    
    document.getElementById(loaderId).scrollIntoView({ behavior: 'smooth', block: 'center' });

    try {
        const response = await fetch('http://127.0.0.1:8000/generate-lesson', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source_material: originalText, // Sending the PDF text again
                user_request: feedbackPrompt,  // Sending the button command
                ui_profile: state.uiProfile,
                severity_score: 5.0
            })
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        
        document.getElementById(loaderId).remove();
        renderAIAsset({ content: data.asset_data.content });

        updateMemoryInstructions("Review the new information below based on your request. Update your pinned facts if necessary.");

    } catch (error) {
        console.error("Feedback Generation Error:", error);
        if (toolbar) { toolbar.style.opacity = '1'; toolbar.style.pointerEvents = 'auto'; }
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

// --- MODAL LOGIC ---
function openProfileModal() {
    const modal = document.getElementById('profile-modal');
    modal.classList.remove('hidden');

    // Fetch the current user from Firebase
    const currentUser = firebase.auth().currentUser;
    
    if (currentUser) {
        document.getElementById('modal-user-email').textContent = currentUser.email;
        document.getElementById('modal-user-id').textContent = currentUser.uid.substring(0, 8) + ''; 
    }
    
    // Set the dropdown to match the currently active profile
    const selector = document.getElementById('modal-theme-selector');
    if (selector) {
        selector.value = state.uiProfile || 'default';
    }
}

function closeProfileModal() {
    document.getElementById('profile-modal').classList.add('hidden');
}

function handleProfileChange(newProfile) {
    // 1. Instantly apply the UI change locally
    applyUIConfig(newProfile);

    localStorage.setItem('neuroLearn_profile', newProfile);
    
    // 2. Save the manual override to Firebase so it remembers for next time
    if (state.userId) {
        db.collection("users").doc(state.userId).set({
            uiProfile: newProfile,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true })
        .then(() => console.log(`User manually overrode profile to: ${newProfile}`))
        .catch((error) => console.error("Error saving manual profile change: ", error));
    }
}

// Allow users to close the modal by clicking the dark background overlay
window.addEventListener('click', function(event) {
    const modal = document.getElementById('profile-modal');
    if (event.target === modal) {
        closeProfileModal();
    }
});

// --- USER ANALYTICS & STATS ---
let learningTimerInterval = null;

function initializeUserStats() {
    if (!state.userId) return;

    // Create a unique storage key for this specific user
    const statsKey = `neuroLearn_stats_${state.userId}`;
    
    // Fetch existing stats or create a default baseline
    let userStats = JSON.parse(localStorage.getItem(statsKey)) || {
        modulesDone: 1, // Start with 1 for the tutorial
        timeLearningMinutes: 0,
        currentStreak: 0,
        lastActiveDate: null
    };

    // --- 1. CALCULATE DAY STREAK ---
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Strip the time, we only care about the date
    const todayTimestamp = today.getTime();

    if (userStats.lastActiveDate) {
        const lastDate = new Date(userStats.lastActiveDate).getTime();
        const diffInDays = Math.round((todayTimestamp - lastDate) / (1000 * 60 * 60 * 24));

        if (diffInDays === 1) {
            // They logged in yesterday, streak continues!
            userStats.currentStreak += 1;
        } else if (diffInDays > 1) {
            // They missed a day, streak resets.
            userStats.currentStreak = 1; 
        }
        // If diffInDays is 0, they already logged in today, do nothing to the streak.
    } else {
        // First time ever logging in
        userStats.currentStreak = 1;
    }
    
    // Update the last active date to today
    userStats.lastActiveDate = todayTimestamp;
    localStorage.setItem(statsKey, JSON.stringify(userStats));
    updateDashboardUI(userStats);

    // --- 2. TRACK TIME LEARNING ---
    // Clear any existing timers so they don't double up
    if (learningTimerInterval) clearInterval(learningTimerInterval);
    
    // Start a timer that adds 1 minute to their stats every 60 seconds
    learningTimerInterval = setInterval(() => {
        // Only count time if they are actively in the learning canvas or tutorial
        if (state.currentView === 'canvas' || state.currentView === 'tutorial') {
            userStats.timeLearningMinutes += 1;
            localStorage.setItem(statsKey, JSON.stringify(userStats));
            updateDashboardUI(userStats);
        }
    }, 60000); // 60,000 milliseconds = 1 minute
}

function updateDashboardUI(stats) {
    const modulesEl = document.getElementById('stat-modules');
    const timeEl = document.getElementById('stat-time');
    const streakEl = document.getElementById('stat-streak');

    if (modulesEl) modulesEl.textContent = stats.modulesDone;
    if (streakEl) streakEl.textContent = stats.currentStreak;

    // Format the time dynamically
    if (timeEl) {
        if (stats.timeLearningMinutes >= 60) {
            const hours = (stats.timeLearningMinutes / 60).toFixed(1);
            timeEl.textContent = `${hours}h`;
        } else {
            timeEl.textContent = `${stats.timeLearningMinutes}m`;
        }
    }
}

// --- MOBILE MENU LOGIC ---
function toggleMobileMenu() {
    const sidebar = document.getElementById('main-nav');
    const overlay = document.getElementById('sidebar-overlay');
    
    sidebar.classList.toggle('mobile-open');
    
    if (sidebar.classList.contains('mobile-open')) {
        overlay.classList.add('active');
    } else {
        overlay.classList.remove('active');
    }
}

// --- DASHBOARD SESSION MANAGEMENT ---
function renderDashboardSessions() {
    const container = document.getElementById('dashboard-sessions-container');
    if (!container) return;

    // If no sessions exist, show a friendly empty state
    if (state.sessions.length === 0) {
        container.innerHTML = `
            <div class="card resume-banner flex items-center justify-between">
                <div>
                    <h2 style="margin: 4px 0;">No Active Lessons</h2>
                    <p class="text-sm text-muted" style="margin: 0;">Upload a document in the Resource Hub to begin.</p>
                </div>
            </div>`;
        return;
    }

    container.innerHTML = ''; // Clear current list

    // Loop through the array and build a card for each session
    state.sessions.forEach(session => {
        const sessionHtml = `
            <div class="card resume-banner flex items-center justify-between" style="margin-bottom: var(--spacing-1-5);">
                <div>
                    <span class="text-xs font-bold text-primary uppercase">Resume Session</span>
                    <h2 style="margin: 4px 0;">${session.filename}</h2>
                    <p class="text-sm text-muted" style="margin: 0;">Your UI preferences are saved.</p>
                </div>
                <div class="flex gap-1">
                    <button onclick="resumeLesson('${session.filename}')" class="btn-primary">
                        <i class="ph ph-play-circle text-lg"></i> Resume
                    </button>
                    <button onclick="deleteSession('${session.filename}')" class="btn-icon danger" style="background: var(--color-bg-card); border: 1px solid var(--color-divider); padding: 10px;">
                        <i class="ph ph-trash"></i>
                    </button>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', sessionHtml);
    });
}

function deleteSession(filename) {
    // 1. Filter the deleted session out of the array
    state.sessions = state.sessions.filter(s => s.filename !== filename);
    
    // 2. Save the updated array locally
    localStorage.setItem('neuroLearn_sessions', JSON.stringify(state.sessions));
    
    // 3. Save to Firebase
    if (state.userId) {
        db.collection("users").doc(state.userId).set({
            sessions: state.sessions,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).catch(err => console.error("Error deleting session:", err));
    }
    
    // 4. Re-render the dashboard to make it disappear
    renderDashboardSessions();
    
    // If they delete the lesson they are currently looking at, clear the canvas
    if (state.activeLesson === filename) {
        state.activeLesson = null;
        const canvasHeader = document.getElementById('canvas-lesson-title');
        if (canvasHeader) canvasHeader.innerHTML = 'Learning: No active session';
        document.getElementById('canvas-content-area').innerHTML = '';
    }
}

// ==========================================
// VOICE ACCESSIBILITY ENGINE (STT & TTS)
// ==========================================

// ==========================================
// VOICE ACCESSIBILITY ENGINE (STT & TTS)
// ==========================================

// --- SPEECH TO TEXT & VOICE COMMANDS (Dictation & Navigation) ---
let recognition;
let isRecording = false;

// 1. The Command Parser
function processVoiceCommand(transcript) {
    // Clean up the text for easier matching (lowercase, remove periods)
    const text = transcript.toLowerCase().replace(/[.,!?]/g, '').trim();
    console.log("Parsing command:", text);

    // Navigation Commands
    if (text.includes('open dashboard') || text.includes('go to dashboard')) {
        navigate('dashboard');
        speakSystemFeedback("Opening dashboard");
        return true;
    }
    if (text.includes('open resource') || text.includes('go to resource')) {
        navigate('resources');
        speakSystemFeedback("Opening resource hub");
        return true;
    }
    
    // Audio Commands
    if (text.includes('read page') || text.includes('read this') || text.includes('read aloud')) {
        toggleTTS();
        return true;
    }
    if (text.includes('stop reading') || text.includes('quiet') || text.includes('shut up')) {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        isSpeaking = false;
        document.getElementById('tts-btn').classList.remove('speaking');
        return true;
    }
    
    // System Commands
    if (text === 'stop listening' || text === 'turn off microphone') {
        speakSystemFeedback("Microphone disabled.");
        stopSTT();
        return true;
    }

    // Dynamic Module Resuming (e.g. "open module biology" or "resume website checklist")
    if (text.includes('open module') || text.includes('resume') || text.includes('open lesson')) {
        if (typeof state !== 'undefined' && state.sessions && state.sessions.length > 0) {
            for (let session of state.sessions) {
                // Remove .pdf from the filename for natural voice matching
                const cleanTitle = session.filename.toLowerCase().replace('.pdf', '').replace('.txt', '');
                
                if (text.includes(cleanTitle)) {
                    speakSystemFeedback(`Resuming ${cleanTitle}`);
                    resumeLesson(session.filename);
                    return true;
                }
            }
        }
        speakSystemFeedback("I couldn't find a module with that name.");
        return true; // We processed it as a command, even if it failed, so don't type it out
    }

    // Not a command, treat as normal dictation
    return false; 
}

// Optional: Give the user audio feedback when a command works
function speakSystemFeedback(message) {
    if (!window.speechSynthesis) return;
    const feedback = new SpeechSynthesisUtterance(message);
    feedback.volume = 0.5; // Keep it quiet so it isn't jarring
    window.speechSynthesis.speak(feedback);
}

// 2. The upgraded Microphone Logic
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    
    // CHANGED: True means it won't turn off when the user takes a breath
    recognition.continuous = true; 
    recognition.interimResults = false;
    
    recognition.onresult = (event) => {
        // Grab the most recent thing they said
        const lastResultIndex = event.results.length - 1;
        const transcript = event.results[lastResultIndex][0].transcript;
        
        // Check if it's a voice command FIRST
        const isCommand = processVoiceCommand(transcript);
        
        // If it wasn't a command, type it out
        if (!isCommand) {
            const activeEl = document.activeElement;
            if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
                const currentVal = activeEl.value;
                activeEl.value = currentVal ? currentVal + ' ' + transcript : transcript;
            } else {
                const canvasInputs = document.querySelectorAll('.custom-message-box.active input');
                if (canvasInputs.length > 0) {
                    const target = canvasInputs[canvasInputs.length - 1];
                    target.value = target.value ? target.value + ' ' + transcript : transcript;
                }
            }
        }
    };
    
    recognition.onerror = (event) => {
        if (event.error !== 'no-speech') {
            console.error("Microphone error:", event.error);
        }
    };
    
    recognition.onend = () => {
        // HANDS-FREE HACK: Browsers forcefully stop the mic after a few minutes of silence.
        // If isRecording is still true, instantly restart it!
        if (isRecording) {
            try { recognition.start(); } catch(e) {}
        } else {
            document.getElementById('stt-btn').classList.remove('recording');
        }
    };
}

function toggleSTT() {
    if (!recognition) {
        alert("Your browser does not support Voice Dictation. Please use Chrome or Edge.");
        return;
    }
    if (isRecording) {
        stopSTT();
    } else {
        startSTT();
        speakSystemFeedback("Listening for commands.");
    }
}

function startSTT() {
    isRecording = true;
    document.getElementById('stt-btn').classList.add('recording');
    try { recognition.start(); } catch(e) {}
}

function stopSTT() {
    isRecording = false;
    document.getElementById('stt-btn').classList.remove('recording');
    try { recognition.stop(); } catch(e) {}
}


// --- TEXT TO SPEECH (Read Aloud) ---
const synth = window.speechSynthesis;
let isSpeaking = false;
let currentUtterance = null; // NEW: Kept in global scope to prevent browser garbage collection bugs!

function toggleTTS() {
    const synth = window.speechSynthesis;
    const btn = document.getElementById('tts-btn');
    
    // 1. Only cancel if it is ACTUALLY speaking or stuck in the queue.
    if (synth.speaking || synth.pending || isSpeaking) {
        synth.cancel(); 
        isSpeaking = false;
        btn.classList.remove('speaking');
        console.log("TTS manually stopped.");
        return; 
    }
    
    // 2. Figure out what to read
    let textToRead = window.getSelection().toString().trim();
    
    if (!textToRead) {
        const aiChunks = document.querySelectorAll('.ai-content-wrapper');
        if (aiChunks.length > 0) {
            const latestChunk = aiChunks[aiChunks.length - 1];
            textToRead = latestChunk.innerText || latestChunk.textContent;
        }
    }
    
    // Clean up the text: remove weird line breaks or extra spaces that crash the API
    textToRead = textToRead.replace(/\s+/g, ' ').trim();

    if (!textToRead || textToRead === '') {
        alert("Please highlight some text or open a lesson first!");
        return;
    }

    console.log("TTS Reading:", textToRead);

    // 3. Prepare the utterance
    currentUtterance = new SpeechSynthesisUtterance(textToRead);
    
    // NEW: Explicitly grab your computer's voices and assign an English one
    // This prevents the "synthesis-failed" error from a missing default voice
    const voices = synth.getVoices();
    if (voices.length > 0) {
        // Try to find an English voice, otherwise just use the first one available
        const defaultVoice = voices.find(voice => voice.lang.startsWith('en')) || voices[0];
        currentUtterance.voice = defaultVoice;
    }
    
    // Apply speed modifiers
    if (typeof state !== 'undefined' && (state.uiProfile === 'aphasia' || state.uiProfile === 'dementia')) {
        currentUtterance.rate = 0.85; 
    } else {
        currentUtterance.rate = 1.0;  
    }
    
    // 4. Handle UI Animations
    currentUtterance.onstart = () => {
        isSpeaking = true;
        btn.classList.add('speaking');
    };
    
    currentUtterance.onend = () => {
        isSpeaking = false;
        btn.classList.remove('speaking');
        currentUtterance = null; 
    };
    
    currentUtterance.onerror = (event) => {
        console.error("TTS Engine Error details:", event);
        isSpeaking = false;
        btn.classList.remove('speaking');
    };
    
    // 5. Speak!
    synth.speak(currentUtterance);
}

function readSpecificChunk(assetId) {
    const chunk = document.getElementById(assetId);
    if (!chunk) return;
    
    // Grab only the text from the content wrapper, ignoring the buttons
    const contentWrapper = chunk.querySelector('.ai-content-wrapper');
    if (!contentWrapper) return;
    
    // Clean the text
    const textToRead = contentWrapper.innerText.replace(/\s+/g, ' ').trim();
    
    // Cancel any current speech
    if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
    }
    
    const utterance = new SpeechSynthesisUtterance(textToRead);
    
    // Find an English voice
    const voices = window.speechSynthesis.getVoices();
    const defaultVoice = voices.find(v => v.lang.startsWith('en')) || voices[0];
    if (defaultVoice) utterance.voice = defaultVoice;
    
    // Aphasia profile benefits from slightly slower pacing
    utterance.rate = 0.85; 
    
    // Visual feedback
    const btn = chunk.querySelector('.aphasia-only i');
    utterance.onstart = () => { if(btn) btn.classList.replace('ph-speaker-high', 'ph-speaker-none'); };
    utterance.onend = () => { if(btn) btn.classList.replace('ph-speaker-none', 'ph-speaker-high'); };
    
    window.speechSynthesis.speak(utterance);
}

function generateProfileAdaptedContent(topic, rawSourceText) {
    let adaptedHtml = "";

    switch(state.uiProfile) {
        case 'aphasia':
            // Plain Language, Short Sentences & Icons everywhere
            adaptedHtml = `
                <div class="flex items-center gap-2 mb-2"><i class="ph ph-cell-signal-full text-3xl text-primary"></i> <h3 style="margin:0;">Cell Division (${topic})</h3></div>
                <p><i class="ph ph-arrow-right text-secondary"></i> One cell splits. It makes two identical cells.</p>
                <p><i class="ph ph-list-numbers text-secondary"></i> There are 4 steps to do this.</p>
            `;
            break;
            
        case 'dementia':
            // Single-Idea Formatting & Direct Instructions
            adaptedHtml = `
                <h3>Learning about ${topic}</h3>
                
                <p>Mitosis is how a single cell divides to make two exact copies of itself.</p>
                
                <p>This process happens in four distinct steps.</p>
                
                <p>You will learn the first step on the next screen.</p>
                
                <div class="card" style="background-color: var(--color-bg-gray); border: 2px solid var(--color-primary);">
                    <strong style="font-size: 1.2em; display: block; margin-bottom: 12px;">Action Required:</strong>
                    <p style="margin-bottom: 16px !important;">Please read the three sentences above. When you are done, click the black button below.</p>
                    <button class="btn-primary" onclick="submitAIFeedback('${topic}', 'understood')">Click Here to See Step 1</button>
                </div>
            `;
            break;

        case 'autism':
            // Logical Structuring, Predictable Sequences & Literal Content
            adaptedHtml = `
                <div class="literal-box" style="margin-bottom: 20px;">
                    <h3 style="margin-top:0; border-bottom: 2px solid #333; padding-bottom: 8px;">Agenda for: ${topic}</h3>
                    <p><strong>What to expect in this module:</strong></p>
                    <ol style="margin-left: 20px;">
                        <li>Read the literal definition of the topic.</li>
                        <li>Review the chronological sequence of events.</li>
                        <li>Complete a text-input verification check.</li>
                    </ol>
                    <p style="font-size: 0.9em; margin-top: 10px;"><em>Status: You are currently on Step 1.</em></p>
                </div>

                <div class="literal-box">
                    <p><strong>Definition:</strong> Mitosis is the biological process of cellular division resulting in two identical cells.</p>
                    <p><strong>Sequence of Events:</strong></p>
                    <ol style="margin-left: 20px;">
                        <li>Prophase</li>
                        <li>Metaphase</li>
                        <li>Anaphase</li>
                        <li>Telophase</li>
                    </ol>
                    <p><strong>Instruction:</strong> Read the list above. When you are finished, click the "Understood" button to proceed to Step 3.</p>
                </div>
            `;
            break;

        case 'impairment':
            // Information Chunking & Decluttered Layout (Hiding secondary info)
            adaptedHtml = `
                <div class="flashcard-q">Core Concept: ${topic}</div>
                <div class="flashcard-a">
                    Mitosis is the biological process where a single cell divides to create two identical cells.
                </div>
                
                <button class="deep-dive-toggle" onclick="this.nextElementSibling.classList.toggle('show')">
                    <i class="ph ph-plus-circle text-xl"></i> Show Detailed Breakdown
                </button>
                
                <div class="deep-dive-content">
                    <p><strong>The Four Main Phases:</strong></p>
                    <ol style="margin-left: 20px;">
                        <li><strong>Prophase:</strong> The cell sets the stage for division.</li>
                        <li><strong>Metaphase:</strong> Chromosomes align in the middle.</li>
                        <li><strong>Anaphase:</strong> Chromosomes are pulled apart.</li>
                        <li><strong>Telophase:</strong> The cell finishes dividing into two.</li>
                    </ol>
                </div>
            `;
            break;
            
        case 'memory':
            // External Memory Aids (Pinning capabilities) & Constant Summaries
            adaptedHtml = `
                <h3>${topic}</h3>
                <p>Mitosis is the process where a single cell divides into two identical daughter cells. It has four main phases.</p>
                
                <button class="btn-secondary text-sm mb-3" onclick="pinFact('Mitosis: 1 cell divides into 2 identical cells. 4 phases.')">
                    <i class="ph ph-push-pin"></i> Pin Summary to Sidebar
                </button>
                
                <div class="alert-box mt-2">
                    <strong>Section Summary:</strong> You just learned that Mitosis is cell division resulting in two copies, happening in four phases.
                </div>
            `;
            break;

        default:
            adaptedHtml = `
                <h3>${topic}</h3>
                <p>${rawSourceText}</p>
            `;
    }
    return adaptedHtml;
}

// --- SHORT-TERM MEMORY LOSS HELPERS ---
function pinFact(factText) {
    // Add to state and save to local storage
    state.pinnedFacts.push(factText);
    localStorage.setItem('neuroLearn_pins', JSON.stringify(state.pinnedFacts));
    
    renderPinnedFacts();
    
    // Provide brief visual feedback on the button they clicked
    const btn = event.currentTarget;
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="ph ph-check text-success"></i> Pinned!`;
    setTimeout(() => { btn.innerHTML = originalText; }, 2000);
}

function renderPinnedFacts() {
    const list = document.getElementById('pinned-facts-list');
    const emptyMsg = document.getElementById('empty-pins-msg');
    if(!list) return;

    if (state.pinnedFacts.length > 0) {
        if(emptyMsg) emptyMsg.style.display = 'none';
        
        // Clear current list items except the empty message
        Array.from(list.children).forEach(child => { if(child.id !== 'empty-pins-msg') child.remove(); });
        
        // Render all saved pins
        state.pinnedFacts.forEach((fact, index) => {
            const li = document.createElement('li');
            li.className = "bg-gray p-2 rounded border border-divider flex justify-between gap-2 items-start";
            li.innerHTML = `
                <span>${fact}</span>
                <button onclick="removePin(${index})" class="text-attention hover:text-red-500" title="Remove Pin"><i class="ph ph-x"></i></button>
            `;
            list.appendChild(li);
        });
    } else {
        if(emptyMsg) emptyMsg.style.display = 'block';
    }
}

function removePin(index) {
    state.pinnedFacts.splice(index, 1);
    localStorage.setItem('neuroLearn_pins', JSON.stringify(state.pinnedFacts));
    renderPinnedFacts();
}

function toggleSensoryMode() {
    const toggleBg = document.getElementById('toggle-sensory');
    document.body.classList.toggle('strict-sensory');
    
    if (document.body.classList.contains('strict-sensory')) {
        toggleBg.classList.add('active');
    } else {
        toggleBg.classList.remove('active');
    }
}

// --- MEMORY PROFILE: Real-time Draft Saving ---
function saveMemoryDraft(text) {
    if (state.uiProfile === 'memory' && state.activeLesson) {
        localStorage.setItem(`neuroLearn_draft_${state.activeLesson}`, text);
        
        // Show the "Saved" indicator temporarily
        const indicators = document.querySelectorAll('.save-indicator');
        indicators.forEach(ind => {
            ind.classList.add('visible');
            setTimeout(() => ind.classList.remove('visible'), 2000);
        });
    }
}

function clearMemoryDraft() {
    if (state.activeLesson) {
        localStorage.removeItem(`neuroLearn_draft_${state.activeLesson}`);
    }
}

function updateMemoryInstructions(instructionText) {
    if (state.uiProfile === 'memory') {
        const instructionBox = document.querySelector('#persistent-instructions span');
        if (instructionBox) {
            instructionBox.innerHTML = `<i class="ph ph-info-k text-primary text-xl"></i> <b>Current Task:</b> ${instructionText}`;
        }
    }
}