// Network error responses are intentional fixtures; uncaught UI errors are not.
module.exports = function rendererErrors(window) {
  const errors = [];
  window.webContents.on("console-message", (details) => {
    if (
      details.level === "error" &&
      /Uncaught (?:\(in promise\) )?/.test(details.message)
    )
      errors.push(details.message);
  });
  return errors;
};
