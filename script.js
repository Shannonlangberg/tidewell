(function () {
  var year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();

  var form = document.getElementById("enquiry-form");
  var status = document.getElementById("form-status");
  if (!form || !status || !window.fetch) return;

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    var button = form.querySelector("button[type=submit]");
    button.disabled = true;
    status.className = "form-status";
    status.textContent = "Sending…";

    var body = new URLSearchParams(new FormData(form)).toString();

    fetch("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body
    })
      .then(function (response) {
        if (!response.ok) throw new Error("Form post failed: " + response.status);
        form.reset();
        status.className = "form-status ok";
        status.textContent = "Thank you. We've got your enquiry and one of us will reply soon.";
        status.setAttribute("tabindex", "-1");
        status.focus();
      })
      .catch(function () {
        status.className = "form-status err";
        status.textContent = "That didn't send. Please check your details and try again in a moment.";
      })
      .then(function () {
        button.disabled = false;
      });
  });
})();
