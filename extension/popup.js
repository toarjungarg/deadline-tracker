// Runs every time the popup opens.

// Find the empty paragraph in popup.html
const message = document.getElementById("message");

// Today's date as text, like "Friday, October 31"
const today = new Date().toLocaleDateString("en-CA", {
  weekday: "long",
  month: "long",
  day: "numeric",
});

// textContent puts it in as plain text, never as code
message.textContent = `Today is ${today}. No deadlines yet.`;
