const APPS_SCRIPT_URL = "PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE";

const REQUIRED_PREFIX = "AW";
const MIN_BARCODE_LENGTH = 7;
const DEBOUNCE_COUNT = 2;

const STATUS_OPTIONS = [
  "At Port",
  "Green Bay",
  "Green Ocean",
  "ARC Integrity",
  "Boat 4"
];

let scans = [];
let lastResults = [];
let currentVideoTrack = null;
let torchOn = false;
let scannerRunning = false;

function showPage(pageId) {
  document.querySelectorAll(".page").forEach(page => {
    page.classList.remove("active");
  });

  document.getElementById(pageId).classList.add("active");

  if (pageId === "scanner-page") {
    setTimeout(startScanner, 300);
  } else {
    stopScannerSafe();
  }
}

function setStatus(message, type = "info") {
  const statusMessage = document.getElementById("status-message");
  statusMessage.textContent = message;
  statusMessage.className = "status-" + type;
}

function isValidBarcode(barcode) {
  return (
    typeof barcode === "string" &&
    barcode.length > MIN_BARCODE_LENGTH &&
    barcode.length <= 100 &&
    barcode.startsWith(REQUIRED_PREFIX)
  );
}

function addScan(tcn, status, isManual) {
  const timestamp = new Date().toISOString();

  scans.push({ timestamp, tcn, status, isManual: !!isManual });

  const row = document.createElement("tr");

  row.innerHTML = `
    <td>${timestamp}</td>
    <td>${tcn}</td>
    <td>${status}</td>
    <td class="sheet-status">Sending...</td>
    <td>${isManual ? "Manual" : "Scanned"}</td>
  `;

  document.getElementById("scans-body").appendChild(row);

  const sheetStatusCell = row.querySelector(".sheet-status");
  sheetStatusCell.style.color = "#cbd5e1";

  blackoutScanner();
  sendTCNToSheet(tcn, status, sheetStatusCell);
}

function blackoutScanner() {
  const overlay = document.getElementById("blackout-overlay");
  overlay.style.opacity = "1";

  setTimeout(() => {
    overlay.style.opacity = "0";
  }, 500);
}

async function sendTCNToSheet(tcn, status, statusCell) {
  try {
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify({
        tcn: tcn,
        status: status
      })
    });

    statusCell.textContent = "Sent";
    statusCell.style.color = "#86efac";
    setStatus("Sent " + tcn + " as " + status, "success");
  } catch (error) {
    statusCell.textContent = "Network error";
    statusCell.style.color = "#fca5a5";
    setStatus("Could not reach Apps Script.", "error");
  }
}

function startScanner() {
  if (scannerRunning) return;

  if (typeof Quagga === "undefined") {
    setStatus("Scanner library failed to load.", "error");
    return;
  }

  setStatus("Starting scanner...", "info");

  Quagga.init(
    {
      inputStream: {
        name: "Live",
        type: "LiveStream",
        target: document.querySelector("#scanner-container"),
        constraints: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          facingMode: "environment"
        }
      },

      locator: {
        patchSize: "medium",
        halfSample: false
      },

      numOfWorkers: navigator.hardwareConcurrency || 4,
      frequency: 10,

      decoder: {
        readers: [
          "code_128_reader",
          "code_39_reader"
        ]
      },

      locate: true
    },
    function(error) {
      if (error) {
        scannerRunning = false;
        setStatus("Error initializing scanner.", "error");
        alert("Error initializing scanner: " + error);
        return;
      }

      Quagga.start();
      Quagga.offDetected(onDetectedHandler);
      Quagga.onDetected(onDetectedHandler);

      scannerRunning = true;
      torchOn = false;

      const torchBtn = document.getElementById("torch-btn");
      if (torchBtn) {
        torchBtn.textContent = "Light On";
      }

      setStatus('Scanning for TCNs starting with "AW"...', "info");
    }
  );
}

async function stopScanner() {
  try {
    Quagga.offDetected(onDetectedHandler);
    await setTorch(false);
    Quagga.stop();
  } catch (error) {
  }

  scannerRunning = false;
  lastResults = [];

  const torchBtn = document.getElementById("torch-btn");
  if (torchBtn) {
    torchBtn.textContent = "Light On";
  }

  setStatus("Scanner stopped.", "info");
}

function stopScannerSafe() {
  try {
    stopScanner();
  } catch (error) {
  }
}

async function setTorch(enabled) {
  try {
    const videoElement = document.querySelector("#scanner-container video");

    if (!videoElement || !videoElement.srcObject) {
      setStatus("Camera must be active before using the light.", "error");
      return;
    }

    const tracks = videoElement.srcObject.getVideoTracks();

    if (!tracks || tracks.length === 0) {
      setStatus("No camera track found.", "error");
      return;
    }

    currentVideoTrack = tracks[0];

    const capabilities = currentVideoTrack.getCapabilities
      ? currentVideoTrack.getCapabilities()
      : {};

    if (!capabilities.torch) {
      setStatus("Light is not supported on this phone/browser.", "error");
      return;
    }

    await currentVideoTrack.applyConstraints({
      advanced: [{ torch: enabled }]
    });

    torchOn = enabled;

    const torchBtn = document.getElementById("torch-btn");
    if (torchBtn) {
      torchBtn.textContent = enabled ? "Light Off" : "Light On";
    }

    setStatus(enabled ? "Light turned on." : "Light turned off.", "info");
  } catch (error) {
    setStatus("Unable to toggle light.", "error");
  }
}

function toggleTorch() {
  setTorch(!torchOn);
}

function onDetectedHandler(result) {
  if (!result || !result.codeResult || !result.codeResult.code) return;

  const barcode = result.codeResult.code.trim();

  if (!isValidBarcode(barcode)) return;

  lastResults.push(barcode);

  if (lastResults.length > DEBOUNCE_COUNT) {
    lastResults.shift();
  }

  const confirmed =
    lastResults.length === DEBOUNCE_COUNT &&
    lastResults.every(value => value === lastResults[0]);

  if (!confirmed) return;

  const lastScan = scans[scans.length - 1];

  if (!lastScan || lastScan.tcn !== barcode) {
    showStatusPopup(barcode, false);
  }

  lastResults = [];
}

function showStatusPopup(tcn, isManual) {
  const overlay = document.getElementById("popup-overlay");
  const buttonsDiv = document.getElementById("popup-buttons");
  const popupTCN = document.getElementById("popup-tcn");

  popupTCN.textContent = tcn;
  buttonsDiv.innerHTML = "";

  STATUS_OPTIONS.forEach(option => {
    const button = document.createElement("button");
    button.textContent = option;

    button.addEventListener("click", function() {
      overlay.style.display = "none";
      addScan(tcn, option, isManual);
    });

    buttonsDiv.appendChild(button);
  });

  overlay.style.display = "flex";
}

function resetScans() {
  scans = [];
  lastResults = [];
  document.getElementById("scans-body").innerHTML = "";
  setStatus("Scan list cleared.", "info");
}

function openManualTCNPopup() {
  document.getElementById("manual-tcn-popup").style.display = "flex";
  document.getElementById("manual-tcn-input").value = "";
  document.getElementById("manual-tcn-error").textContent = "";
  document.getElementById("manual-tcn-input").focus();
}

function closeManualTCNPopup() {
  document.getElementById("manual-tcn-popup").style.display = "none";
}

function submitManualTCN() {
  const tcn = document.getElementById("manual-tcn-input").value.trim();

  if (!isValidBarcode(tcn)) {
    document.getElementById("manual-tcn-error").textContent =
      "Invalid TCN. Must start with AW and be at least 8 characters.";
    return;
  }

  closeManualTCNPopup();
  showStatusPopup(tcn, true);
}

document.getElementById("start-btn").addEventListener("click", startScanner);
document.getElementById("stop-btn").addEventListener("click", stopScanner);
document.getElementById("torch-btn").addEventListener("click", toggleTorch);
document.getElementById("reset-btn").addEventListener("click", resetScans);
document.getElementById("manual-tcn-btn").addEventListener("click", openManualTCNPopup);
document.getElementById("manual-tcn-cancel").addEventListener("click", closeManualTCNPopup);
document.getElementById("manual-tcn-submit").addEventListener("click", submitManualTCN);

document.getElementById("manual-tcn-input").addEventListener("keydown", function(event) {
  if (event.key === "Enter") {
    submitManualTCN();
  }
});