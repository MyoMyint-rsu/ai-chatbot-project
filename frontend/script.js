const API_BASE_URL = "https://ai-chatbot-backend-sata.onrender.com";

const messages = document.getElementById("messages");
const typing = document.getElementById("typing");
const input = document.getElementById("questionInput");
const form = document.getElementById("chatForm");
const logList = document.getElementById("logList");
const quickButtons = document.querySelectorAll(".quick-btn");

function addMessage(text, type) {
  const div = document.createElement("div");
  div.className = `msg ${type}`;
  div.textContent = text;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function addLog(question, answer) {
  const item = document.createElement("div");
  item.className = "log-item";
  item.innerHTML = `
    <strong>Q:</strong> ${escapeHtml(question)}<br>
    <strong>A:</strong> ${escapeHtml(answer).slice(0, 120)}
  `;
  logList.prepend(item);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function getSessionId() {
  let sessionId = localStorage.getItem("chat_session_id");
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem("chat_session_id", sessionId);
  }
  return sessionId;
}

async function sendMessage(question) {
  const userText = question.trim();
  if (!userText) return;

  addMessage(userText, "user");
  input.value = "";

  typing.hidden = false;
  messages.appendChild(typing);
  messages.scrollTop = messages.scrollHeight;

  try {
    const response = await fetch(`${API_BASE_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: userText,
        sessionId: getSessionId()
      })
    });

    const data = await response.json();
    typing.hidden = true;

    if (!response.ok) {
      addMessage(data.error || "Something went wrong.", "bot");
      return;
    }

    addMessage(data.reply, "bot");
    addLog(userText, data.reply);
  } catch (error) {
    typing.hidden = true;
    addMessage("Connection error. Please try again.", "bot");
  }
}

form.addEventListener("submit", function (event) {
  event.preventDefault();
  sendMessage(input.value);
});

quickButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const question = button.dataset.question || "";
    sendMessage(question);
  });
});
