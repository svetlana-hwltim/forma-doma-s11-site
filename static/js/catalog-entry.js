const getSelectedCatalogModel = (() => {
  const noSelection = () => null;
  const calculator = document.querySelector('#calculator-form');
  const request = document.querySelector('#request-form');
  const forms = [calculator, request];
  const draftPrefix = 'forma-doma:calculator:';
  const dimensionDraft = /^\d{0,3}(?:[.,]\d{0,8})?$/;
  for (const name of ['width', 'height']) {
    const field = calculator.elements[name];
    const key = draftPrefix + name;
    try {
      const saved = sessionStorage.getItem(key);
      if (saved !== null && dimensionDraft.test(saved) && field.value === field.defaultValue) {
        field.value = saved;
      }
    } catch {
      // The calculator still works if storage is unavailable.
    }
    field.addEventListener('input', () => {
      const value = field.value.trim();
      try {
        if (dimensionDraft.test(value)) sessionStorage.setItem(key, value);
        else sessionStorage.removeItem(key);
      } catch {
        // Keep the typed value in the field.
      }
    });
  }

  const params = new URLSearchParams(location.search);
  const categories = params.getAll('category');
  const slugs = params.getAll('model');
  const category = categories.length === 1 ? categories[0] : null;
  const targetForm = {
    '#calculator': calculator,
    '#request': request,
  }[location.hash];
  const supportsCategory = form => Array.from(form.elements.category.options)
    .some(option => option.value === category);
  if (!category || !targetForm || !supportsCategory(targetForm)) return noSelection;

  let selected = slugs.length === 1 && typeof CATALOG_MODELS !== 'undefined'
    ? CATALOG_MODELS.find(model => model.category === category && model.slug === slugs[0])
    : null;
  if (!selected || !forms.every(supportsCategory)) {
    targetForm.elements.category.value = category;
    return noSelection;
  }

  const panels = forms.map(form => form.querySelector('.selected-model'));
  function clearModel() {
    if (!selected) return;
    selected = null;
    for (const panel of panels) {
      panel.hidden = true;
      panel.querySelector('[data-model-name]').textContent = '';
    }
    const url = new URL(location.href);
    url.searchParams.delete('model');
    url.searchParams.delete('category');
    history.replaceState(history.state, '', url);
  }

  forms.forEach((form, index) => {
    const select = form.elements.category;
    const panel = panels[index];
    select.value = category;
    panel.querySelector('[data-model-name]').textContent = selected.name;
    panel.hidden = false;
    panel.querySelector('[data-remove-model]').addEventListener('click', () => {
      clearModel();
      select.focus();
    });
    select.addEventListener('change', () => {
      if (select.value !== category) clearModel();
    });
  });
  request.addEventListener('reset', clearModel);
  return formCategory => selected?.category === formCategory ? selected.slug : null;
})();
