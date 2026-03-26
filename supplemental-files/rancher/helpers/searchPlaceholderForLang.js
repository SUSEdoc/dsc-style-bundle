"use strict";

const searchPlaceholders = {
	en: "Search the docs",
	de: "Dokumentation durchsuchen",
	es: "Buscar en los documentos",
	fr: "Searchercher dans les documents",
	pt: "Pesquisar na documentação",
	ja: "ドキュメントを検索",
	zh: "搜索文档",
};

module.exports = (lang) => {
	return searchPlaceholders[lang] || searchPlaceholders.en;
};
