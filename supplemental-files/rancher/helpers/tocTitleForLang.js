"use strict";

const tocTitles = {
	en: "On this page",
	de: "Auf dieser Seite",
	es: "En esta página",
	fr: "Sur cette page",
	pt: "Nesta página",
	ja: "このページで",
	zh: "在此页面上",
};

module.exports = (lang) => {
	return tocTitles[lang] || tocTitles.en;
};
