module.exports = async (page, waitFor) => {
  await waitFor("!!document.querySelector('[data-action=open-local-project]')");
  await page("document.querySelector('[data-action=open-local-project]').click()");
  await waitFor("!!document.querySelector('.app-shell[data-project-id]')");
};
