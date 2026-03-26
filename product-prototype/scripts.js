// --- STATE MANAGEMENT ---
const savedUserId = localStorage.getItem('neuroLearn_userId');
const savedProfile = localStorage.getItem('neuroLearn_profile') || 'default';
// NEW: Fetch the array of sessions, or default to an empty array
const savedSessions = JSON.parse(localStorage.getItem('neuroLearn_sessions')) || [];

const state = {
    userId: savedUserId,
    currentView: savedUserId ? 'dashboard' : 'login',
    isDarkMode: false,
    uiProfile: savedProfile,
    sessions: savedSessions,
    activeLesson: null,
    fileContents: {}
};

// --- INITIAL APP LOAD ---
document.addEventListener("DOMContentLoaded", () => {
    applyUIConfig(state.uiProfile);
    renderDashboardSessions();
    navigate(state.currentView);
    
    // NEW: Inject the saved lesson title into the Dashboard
    const dashboardTitle = document.getElementById('dashboard-active-lesson');
    if (dashboardTitle) dashboardTitle.textContent = state.activeLesson;
    
    if (state.userId) {
        initializeUserStats();
    }
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

  setTimeout(() => {
    const profiles = ['default', 'aphasia', 'memory', 'autism', 'dementia', 'impairment'];
    const determinedProfile = profiles[Math.floor(Math.random() * profiles.length)]; 
    
    const logDisplay = document.getElementById('telemetry-log-display');
    logDisplay.textContent = `AI Sync Complete. Profile selected: ${determinedProfile}`;
    logDisplay.classList.add('text-success');

    // NEW: Save the generated profile to Firestore
    if (state.userId) {
      // Save locally
      localStorage.setItem('neuroLearn_userId', state.userId);
      localStorage.setItem('neuroLearn_profile', determinedProfile);

      // Save to cloud
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
      initializeUserStats();
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

// --- DYNAMIC AI CANVAS RENDERING ---
async function generateLesson(filename) {
    // 1. THE TRAFFIC COP: Check if a session for this file already exists
    const sessionExists = state.sessions.find(s => s.filename === filename);
    
    if (sessionExists) {
        // If it exists, immediately route them to the resume logic and stop!
        console.log("Session already exists, resuming instead of restarting.");
        resumeLesson(filename);
        return; 
    }

    // --- Only run the code below for BRAND NEW lessons ---

    const canvasContainer = document.getElementById('canvas-content-area');
    const canvasHeader = document.getElementById('canvas-lesson-title');
    
    state.activeLesson = filename;
    
    // Add the new lesson to the top of the sessions array
    state.sessions.unshift({ id: Date.now(), filename: filename });
    
    // Save locally and to Firebase
    localStorage.setItem('neuroLearn_sessions', JSON.stringify(state.sessions));
    localStorage.setItem('neuroLearn_activeLesson', filename);
    
    if (state.userId) {
        db.collection("users").doc(state.userId).set({
            sessions: state.sessions,
            activeLesson: filename,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    }
    
    // Update the dashboard UI with the new card
    renderDashboardSessions();
    
    if (canvasHeader) canvasHeader.innerHTML = `Learning: ${filename}`;
    navigate('canvas');
    canvasContainer.innerHTML = ''; 
    
    if (typeof TelemetryTracker !== 'undefined') TelemetryTracker.start();

    // Generate the initial AI greeting
    const startingAsset = {
        content: `
            <h3>Let's begin exploring ${filename}.</h3>
            <p>I have analyzed the document and will adapt this material to your <b>${state.uiProfile}</b> preferences. To start, what is the most basic core concept you want to cover?</p>
        `
    };
    renderAIAsset(startingAsset);
}

// UPDATED: Now accepts the specific filename to resume
function resumeLesson(filename) {
    const canvasContainer = document.getElementById('canvas-content-area');
    const canvasHeader = document.getElementById('canvas-lesson-title');

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
    
    // The HTML structure for a single AI response + the 5 interaction buttons
    const chunkHtml = `
      <div class="card chunk" id="${assetId}" style="animation: fadeIn 0.5s ease;">
        
        <div class="ai-content-wrapper" style="font-size: ${state.uiProfile === 'dementia' ? '1.2em' : '1em'};">
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
            <input type="text" id="input-${assetId}" placeholder="Ask a question or request a format (e.g., 'Make a mind map')...">
            <button class="btn-primary" onclick="submitAIFeedback('${assetId}', 'custom')"><i class="ph ph-paper-plane-right"></i></button>
        </div>
      </div>
    `;
    
    canvasContainer.insertAdjacentHTML('beforeend', chunkHtml);
    
    // Smooth scroll so the new asset is exactly in the center of the screen
    setTimeout(() => {
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
function submitAIFeedback(assetId, action) {
    // 1. Lock the previous toolbar so they can't click it again
    const toolbar = document.getElementById(`toolbar-${assetId}`);
    toolbar.style.opacity = '0.5';
    toolbar.style.pointerEvents = 'none';
    document.getElementById(`custom-msg-${assetId}`).classList.remove('active');

    // 2. Extract custom text if they typed something
    let customText = "";
    if (action === 'custom') {
        customText = document.getElementById(`input-${assetId}`).value;
        if (!customText.trim()) {
            alert("Please enter a message.");
            toolbar.style.opacity = '1';
            toolbar.style.pointerEvents = 'auto';
            return;
        }
    }

    // 3. Increment "Modules Done" stat in the background
    if (state.userId) {
        const statsKey = `neuroLearn_stats_${state.userId}`;
        let userStats = JSON.parse(localStorage.getItem(statsKey));
        if (userStats) {
            userStats.modulesDone += 1;
            localStorage.setItem(statsKey, JSON.stringify(userStats));
            if (typeof updateDashboardUI === 'function') updateDashboardUI(userStats);
        }
    }

    // 4. Show the loading spinner
    const canvasContainer = document.getElementById('canvas-content-area');
    const loaderId = `loader-${Date.now()}`;
    canvasContainer.insertAdjacentHTML('beforeend', `
        <div id="${loaderId}" class="text-center mt-10" style="padding: 40px 0;">
            <i class="ph ph-spinner-gap animate-spin text-primary text-4xl mb-2"></i>
            <p class="text-sm text-muted">AI is generating the next adaptive asset...</p>
        </div>
    `);
    
    document.getElementById(loaderId).scrollIntoView({ behavior: 'smooth', block: 'center' });

    // 5. SIMULATE Python Backend Processing (1.5 second delay)
    // Later, you will replace this setTimeout with your actual fetch() request to your Python API
    setTimeout(() => {
        document.getElementById(loaderId).remove();
        
        let generatedContent = "";
        
        // Mocking the AI's contextual responses
        if (action === 'understood') {
            generatedContent = `<h3>Excellent.</h3><p>Since you understood that, let's move forward to the next logical step in the progression.</p>`;
        } else if (action === 'not_understood') {
            generatedContent = `<h3>Let's break that down.</h3><p>Here is a simpler analogy to help conceptualize the previous point...</p><div class="ai-tint card-sm" style="border-radius: 4px; margin-top: 8px;"><p class="text-sm" style="margin: 0;"><strong>Analogy:</strong> Think of it like building a house...</p></div>`;
        } else if (action === 'elaborate') {
            generatedContent = `<h3>Diving Deeper</h3><p>Here are the detailed mechanics behind that concept:</p><ul style="list-style-type: disc; margin-left: 20px; margin-top: 8px;"><li>First primary factor.</li><li>Secondary underlying mechanism.</li></ul>`;
        } else if (action === 'concise') {
            generatedContent = `<h3>Summary (TL;DR)</h3><p><strong>Core Point:</strong> The main takeaway is X causes Y under Z conditions.</p>`;
        } else if (action === 'custom') {
            generatedContent = `<h3>Addressing your request:</h3><p>You asked: <i>"${customText}"</i></p><p>Here is the dynamically generated asset you requested:</p><div style="border: 2px dashed var(--color-primary); padding: 30px; text-align: center; border-radius: 8px; margin-top: 10px; color: var(--color-primary);"><i class="ph ph-image text-3xl"></i><br>Dynamic Visual Generated Here</div>`;
        }

        // Render the new asset to the screen
        renderAIAsset({ content: generatedContent });

    }, 1500);
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