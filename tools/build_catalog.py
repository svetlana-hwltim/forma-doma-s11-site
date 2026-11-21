"""Generate the catalog's static HTML from catalog/data.json. No dependencies."""

import json
import re
from html import escape
from pathlib import Path
from urllib.parse import urlencode


ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "catalog"
SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
IMAGE = re.compile(r"[a-z0-9-]+\.(?:webp|png|jpg)")
LAYOUTS = {
    "linear": ("upper",),
    "corner": ("upper", "left"),
    "u-shape": ("upper", "left", "right"),
    "island": ("upper", "island"),
}
PALETTES = {"linen", "olive", "cream", "terra"}
KEYS = {"kitchen", "wardrobe", "closet", "storage"}


def validate_entries(entries):
    slugs = [item["slug"] for item in entries]
    if not all(SLUG.fullmatch(slug) for slug in slugs) or len(set(slugs)) != len(slugs):
        raise ValueError("Catalog slugs must be valid and unique within the page group.")


def photo(root, file, alt, caption, *, variant="", lazy=False):
    if not IMAGE.fullmatch(file) or not (ROOT / "static/images" / file).is_file():
        raise ValueError(f"Unknown catalog image: {file}")
    size = ' width="1536" height="1024"' if variant else ""
    loading = ' loading="lazy" decoding="async"' if lazy else ""
    return (
        f'<figure class="catalog-photo{variant}"><img src="{root}static/images/{file}" '
        f'alt="{escape(alt)}"{size}{loading}>'
        f'<figcaption>{escape(caption)}</figcaption></figure>'
    )


def plan(model):
    palette = model["palette"]
    if palette not in PALETTES:
        raise ValueError(f"Unknown palette for {model['slug']}")
    parts = "".join(f'<span class="plan-{part}" aria-hidden="true"></span>'
                    for part in LAYOUTS[model["layout"]])
    return (f'<div class="layout-plan palette-{palette}" role="img" '
            f'aria-label="Демонстрационная схема: {escape(model["configuration"])}">'
            f'{parts}<span class="plan-note">Демонстрационная схема</span></div>')


def items(values):
    return "<ul>" + "".join(f"<li>{escape(value)}</li>" for value in values) + "</ul>"


def entry_url(root, key, target, model=None):
    if key not in KEYS:
        raise ValueError(f"Unknown calculator category: {key}")
    params = {"category": key}
    if model:
        params["model"] = model
    return escape(f"{root}index.html?{urlencode(params)}#{target}")


def actions(root, key, model=None):
    return f"""<div class="model-actions">
        <a class="button primary" href="{entry_url(root, key, "calculator", model)}">Рассчитать стоимость</a>
        <a class="button outline" href="{entry_url(root, key, "request", model)}">Оставить заявку</a>
      </div>"""


def model_photo(root, model, *, card=False):
    image = model.get("photo")
    if not image:
        return plan(model)
    variant = " card-photo" if card else " model-photo"
    return photo(root, image["file"], image["alt"], image["caption"], variant=variant, lazy=card)


def page(title, root, crumbs, body):
    trail = [("Главная", f"{root}index.html"), ("Виды мебели", f"{root}index.html#furniture"), *crumbs]
    links = ' <span aria-hidden="true">/</span> '.join(
        f'<a href="{href}">{escape(label)}</a>' if href else
        f'<span aria-current="page">{escape(label)}</span>'
        for label, href in trail
    )
    return f"""<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="{escape(title)} — каталог учебного проекта «Форма Дома».">
  <title>{escape(title)} — Форма Дома</title>
  <link rel="stylesheet" href="{root}static/css/site.css?v=catalog-4">
  <link rel="stylesheet" href="{root}static/css/catalog.css?v=catalog-4">
</head>
<body>
  <header class="site-header catalog-header">
    <div class="wrap header-inner">
      <a class="brand" href="{root}index.html" aria-label="Форма Дома — главная"><span class="brand-icon" aria-hidden="true"><i></i></span>Форма Дома</a>
      <a class="button outline" href="{root}index.html#furniture">Виды мебели</a>
    </div>
  </header>
  <main class="wrap catalog-main">
    <nav class="breadcrumbs" aria-label="Хлебные крошки">{links}</nav>
    {body}
  </main>
  <footer>
    <div class="wrap footer-inner">
      <a class="brand" href="{root}index.html">Форма Дома</a>
      <span>Краснодар · Учебный проект</span>
      <a href="{root}privacy.html">Политика обработки данных</a>
    </div>
  </footer>
</body>
</html>
"""


def model_card(root, category, model):
    estimate = entry_url(root, category["key"], "calculator", model["slug"])
    return f"""<article class="model-card">
        {model_photo(root, model, card=True)}
        <div class="model-card-copy">
          <h3>{escape(model["name"])}</h3>
          <p class="configuration">{escape(model["configuration"])}</p>
          <p>{escape(model["summary"])}</p>
          {items(model["features"])}
          <div class="model-actions">
            <a class="button primary" href="{model["slug"]}/" aria-label="Подробнее: {escape(model["name"])}">Подробнее</a>
            <a class="button outline" href="{estimate}">Рассчитать стоимость</a>
          </div>
        </div>
      </article>"""


def category_page(category, categories):
    root = "../../"
    name = category["name"]
    navigation = []
    for item in categories:
        current = ' aria-current="page"' if item is category else ""
        navigation.append(f'<a href="../{item["slug"]}/"{current}>{escape(item["name"])}</a>')
    if category["models"]:
        cards = "\n      ".join(model_card(root, category, model) for model in category["models"])
        content = f"""<section class="catalog-models" aria-labelledby="models-title">
      <h2 id="models-title">Модели</h2>
      <div class="model-grid">{cards}</div>
    </section>"""
    else:
        content = f"""<section class="catalog-empty" aria-labelledby="models-title">
      <h2 id="models-title">Модели готовятся</h2>
      <p>Пока можно рассчитать стоимость мебели этой категории или оставить заявку.</p>
      {actions(root, category["key"])}
    </section>"""
    body = f"""<section class="catalog-lead">
      <div>
        <h1>{escape(name)}</h1>
        <p class="summary">{escape(category["intro"])}</p>
      </div>
      {photo(root, category["image"], category["imageAlt"], "Демонстрационный интерьер")}
    </section>
    <nav class="category-links" aria-label="Категории мебели">{"".join(navigation)}</nav>
    {content}
    <a class="catalog-back" href="{root}index.html#furniture">← Все виды мебели</a>"""
    return page(name, root, [(name, None)], body)


def model_page(category, model):
    root = "../../../"
    specifications = [("Конфигурация", model["configuration"]), *model.get("specifications", [])]
    rows = "".join(f"<dt>{escape(label)}</dt><dd>{escape(value)}</dd>" for label, value in specifications)
    gallery = ""
    if model.get("gallery"):
        photographs = "\n      ".join(
            photo(root, image["file"], image["alt"], image["caption"], variant=" gallery-photo", lazy=True)
            for image in model["gallery"]
        )
        gallery = f"""<section class="model-gallery" aria-labelledby="gallery-title">
      <h2 id="gallery-title">Детали модели</h2>
      <div class="gallery-grid">{photographs}</div>
    </section>"""
    body = f"""<section class="model-lead">
      <div class="model-heading">
        <h1>{escape(model["name"])}</h1>
        <p class="configuration">{escape(model["configuration"])}</p>
      </div>
      {model_photo(root, model)}
      <div class="model-copy">
        <p class="summary">{escape(model["description"])}</p>
        {actions(root, category["key"], model["slug"])}
      </div>
    </section>
    <div class="model-details">
      <section><h2>Характеристики</h2><dl>{rows}</dl></section>
      <section>
        <h2>Возможные материалы</h2>{items(model["materials"])}
        <h3>Преимущества</h3>{items(model["features"])}
      </section>
    </div>
    {gallery}
    <a class="catalog-back" href="../">← Назад к категории «{escape(category["name"])}»</a>"""
    return page(model["name"], root, [(category["name"], "../"), (model["name"], None)], body)


def main():
    categories = json.loads((CATALOG / "data.json").read_text(encoding="utf-8"))["categories"]
    validate_entries(categories)
    if {category["key"] for category in categories} != KEYS or len(categories) != len(KEYS):
        raise ValueError("Catalog categories must match the calculator.")
    registry = []
    for category in categories:
        validate_entries(category["models"])
        directory = CATALOG / category["slug"]
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "index.html").write_text(category_page(category, categories), encoding="utf-8", newline="\n")
        for model in category["models"]:
            registry.append({
                "category": category["key"], "slug": model["slug"], "name": model["name"],
            })
            model_directory = directory / model["slug"]
            model_directory.mkdir(exist_ok=True)
            (model_directory / "index.html").write_text(model_page(category, model), encoding="utf-8", newline="\n")
    models_js = "// Generated by tools/build_catalog.py from catalog/data.json.\n"
    models_js += "const CATALOG_MODELS = " + json.dumps(registry, ensure_ascii=False, indent=2) + ";\n"
    (ROOT / "static/js/catalog-models.js").write_text(models_js, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
