const NP_STATE = {
    edition: null,
    archive: { clips: [], editions: [] },
    settings: null,
    currentSection: "front",
    archiveSubtab: "clips",
    clipSearch: "",
    clipSectionFilter: "all",
    selectedDate: "",
    pendingClip: null,
    clipRegistry: {},
    votedMap: {},
    editingClipId: null,
    pollTimer: null,
    pollCount: 0,
    pendingRefreshToast: false,
};

document.addEventListener("DOMContentLoaded", () => {
    const initSec = new URLSearchParams(window.location.search).get("section");
    if (initSec) {
        const tabs = document.querySelectorAll(".section-tab");
        const targetTab = Array.from(tabs).find((t) => t.dataset.section === initSec);
        if (targetTab) {
            NP_STATE.currentSection = initSec;
            tabs.forEach((t) => {
                t.classList.toggle("active", t === targetTab);
            });
        }
    }
    loadEdition(false);
    loadArchive(true);
});

function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function showToast(msg) {
    const el = document.getElementById("np-toast");
    if (!el) return;
    el.textContent = msg;
    el.style.display = "block";
    clearTimeout(window._npToastTimer);
    window._npToastTimer = setTimeout(() => {
        el.style.display = "none";
    }, 3200);
}

function formatRelativeTime(pubDateStr) {
    if (!pubDateStr) return "Today";
    const dt = new Date(pubDateStr);
    if (isNaN(dt.getTime())) return pubDateStr.slice(0, 16);
    const diffMin = Math.round((Date.now() - dt.getTime()) / 60000);
    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.round(diffHr / 24);
    return `${diffDay}d ago`;
}

function registerClipItem(key, payload) {
    NP_STATE.clipRegistry[key] = payload;
    return key;
}

async function loadEdition(forceRefresh = false, dateStr = "", isPoll = false) {
    const loadingEl = document.getElementById("press-loading");
    const errorEl = document.getElementById("press-error");
    const refreshBtn = document.getElementById("refresh-edition-btn");
    let isStillPolling = false;

    if (NP_STATE.pollTimer) {
        clearTimeout(NP_STATE.pollTimer);
        NP_STATE.pollTimer = null;
    }
    if (!isPoll) {
        NP_STATE.pollCount = 0;
        NP_STATE.pendingRefreshToast = Boolean(forceRefresh);
    }

    if (errorEl) errorEl.style.display = "none";
    if (loadingEl) loadingEl.style.display = "flex";
    if (refreshBtn) refreshBtn.disabled = true;

    try {
        const params = new URLSearchParams();
        if (forceRefresh && !isPoll) params.set("refresh", "true");
        if (dateStr) params.set("date", dateStr);

        const url = `/newspaper/api/edition${params.toString() ? "?" + params.toString() : ""}`;
        const resp = await fetch(url);
        if (resp.status === 401) {
            window.location.href = "/login";
            return;
        }

        const rawText = await resp.text();
        let data = null;
        try {
            data = JSON.parse(rawText);
        } catch (parseErr) {
            if (NP_STATE.pollCount < 30) {
                NP_STATE.pollCount += 1;
                isStillPolling = true;
                const subEl = loadingEl ? loadingEl.querySelector(".press-loading-sub") : null;
                if (subEl) {
                    subEl.textContent = "Waiting for the morning press server to finish typesetting...";
                }
                NP_STATE.pollTimer = setTimeout(() => loadEdition(false, dateStr, true), 3000);
                return;
            }
            throw new Error("Morning press server timed out returning JSON. Please tap Reprint in a moment.");
        }

        if (resp.status === 202 || (data && data.status === "printing")) {
            const subEl = loadingEl ? loadingEl.querySelector(".press-loading-sub") : null;
            if (subEl && data.message) {
                subEl.textContent = data.message;
            }
            if (NP_STATE.pollCount < 45) {
                NP_STATE.pollCount += 1;
                isStillPolling = true;
                NP_STATE.pollTimer = setTimeout(() => loadEdition(false, dateStr, true), 2500);
                return;
            }
            throw new Error("Morning press is taking longer than expected. Please try refreshing.");
        }

        if (!resp.ok || data.error) {
            throw new Error((data && data.error) || "Failed to load edition");
        }

        NP_STATE.edition = data;
        NP_STATE.selectedDate = data.is_past_edition ? data.date : "";
        NP_STATE.clipRegistry = {};

        renderMasthead(data);
        renderCurrentSection();
        updatePastEditionBanner(data);
        loadArchive(true);

        if (NP_STATE.pendingRefreshToast) {
            NP_STATE.pendingRefreshToast = false;
            showToast("Special Edition printed!");
        }
    } catch (err) {
        console.error(err);
        NP_STATE.pendingRefreshToast = false;
        if (errorEl) {
            errorEl.textContent = `Could not print edition: ${err.message}`;
            errorEl.style.display = "block";
        }
    } finally {
        if (!isStillPolling) {
            if (loadingEl) loadingEl.style.display = "none";
            if (refreshBtn) refreshBtn.disabled = false;
        }
    }
}

function updatePastEditionBanner(edition) {
    const banner = document.getElementById("past-edition-banner");
    const label = document.getElementById("past-edition-date-label");
    if (!banner || !label) return;
    if (edition && edition.is_past_edition) {
        label.textContent = edition.date_display || edition.date;
        banner.style.display = "flex";
    } else {
        banner.style.display = "none";
    }
}

function returnToToday() {
    const sel = document.getElementById("past-edition-select");
    if (sel) sel.value = "";
    loadEdition(false, "");
}

function onSelectPastEdition(dateVal) {
    if (!dateVal) {
        returnToToday();
    } else {
        loadEdition(false, dateVal);
    }
}

function renderMasthead(ed) {
    document.getElementById("masthead-title").textContent = ed.masthead_title || "The Daily Dispatch";
    document.getElementById("masthead-subtitle").textContent = ed.masthead_subtitle || "";
    document.getElementById("masthead-issue").textContent = `${ed.issue_number || "VOL. I"} • PERSONAL EDITION`;
    document.getElementById("dateline-date").textContent = ed.date_display || ed.date || "";
    document.getElementById("dateline-location").textContent = (ed.weather && ed.weather.location) || "Personal Desk";
    document.getElementById("dateline-meta").textContent = `Printed ${ed.generated_display || ""} • ${ed.ai_model_used || ""}`;

    const weatherEl = document.getElementById("masthead-weather");
    if (weatherEl && ed.weather) {
        const w = ed.weather;
        const tempStr = w.temp_f !== null && w.temp_f !== undefined ? `${w.temp_f}°F` : "--";
        const hiLo = w.high_f !== null && w.low_f !== null ? ` (H ${w.high_f}° / L ${w.low_f}°)` : "";
        weatherEl.innerHTML = `<span class="weather-icon">${escapeHtml(w.icon || "🗞️")}</span> <span>${escapeHtml(w.location || "")}: ${escapeHtml(tempStr)} ${escapeHtml(w.condition || "")}${escapeHtml(hiLo)}</span>`;
    }

    const garminEl = document.getElementById("masthead-garmin");
    if (garminEl) {
        const g = ed.garmin_corner || {};
        if (g.readiness_score) {
            garminEl.innerHTML = `<span>⚡ Readiness: <strong>${escapeHtml(g.readiness_score)}</strong> (${escapeHtml(g.readiness_category || "Ready")})</span>`;
        } else if (g.latest_activity) {
            garminEl.innerHTML = `<span>🚴 Last: ${escapeHtml(g.latest_activity.name)}</span>`;
        } else {
            garminEl.innerHTML = `<span>⚡ Athlete's Desk</span>`;
        }
    }

    const archBtn = document.getElementById("archive-edition-btn");
    if (archBtn) {
        if (ed.archived) {
            archBtn.classList.add("is-archived");
            archBtn.innerHTML = `<span>★</span> <span class="hide-sm">Saved</span>`;
        } else {
            archBtn.classList.remove("is-archived");
            archBtn.innerHTML = `<span>☆</span> <span class="hide-sm">Save</span>`;
        }
    }
}

function switchSection(sectionKey) {
    NP_STATE.currentSection = sectionKey;
    document.querySelectorAll(".section-tab").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.section === sectionKey);
    });
    if (sectionKey === "archive") {
        loadArchive(false);
    } else {
        renderCurrentSection();
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderCurrentSection() {
    const canvas = document.getElementById("newspaper-canvas");
    if (!canvas) return;
    const sec = NP_STATE.currentSection;
    if (sec === "archive") {
        renderArchiveView(canvas);
        return;
    }
    const ed = NP_STATE.edition;
    if (!ed) return;

    if (sec === "front") {
        renderFrontPage(canvas, ed);
    } else if (sec === "curiosity") {
        renderCuriosityPage(canvas, ed);
    } else if (sec === "comics") {
        renderComicsPage(canvas, ed);
    } else {
        renderNewsSectionPage(canvas, ed, sec);
    }
}

function renderFrontPage(canvas, ed) {
    const lead = ed.lead_story || {};
    const leadKey = registerClipItem("lead-story", {
        title: lead.headline || "Lead Story",
        summary: (lead.body_paragraphs || [])[0] || lead.subheadline || "",
        content: (lead.body_paragraphs || []).join("\n\n"),
        url: ((lead.related_links || [])[0] || {}).url || "",
        source: lead.byline || ed.masthead_title,
        section: "front",
        edition_date: ed.date,
    });

    const leadBodyHtml = (lead.body_paragraphs || [])
        .map((p) => `<p>${escapeHtml(p)}</p>`)
        .join("");

    const leadLinksHtml = (lead.related_links || [])
        .map(
            (lnk) =>
                `<a href="${escapeHtml(lnk.url)}" target="_blank" rel="noopener noreferrer" class="np-action-btn primary-link">Read ${escapeHtml(lnk.source || "Source")} ↗</a>`
        )
        .join("");

    const briefingHtml = (ed.morning_briefing || [])
        .map((b) => `<li>${escapeHtml(b)}</li>`)
        .join("");

    // Top 1 story from each section for Above-the-Fold Wire
    const wireItemsHtml = Object.entries(ed.sections || {})
        .map(([key, sec]) => {
            const first = (sec.articles || [])[0];
            if (!first) return "";
            return `
                <div class="wire-mini-item">
                    <div class="wire-mini-sec">${escapeHtml(sec.title)} • ${escapeHtml(first.source || "")}</div>
                    <a href="${escapeHtml(first.link)}" target="_blank" rel="noopener noreferrer" class="wire-mini-link">${escapeHtml(first.title)}</a>
                </div>
            `;
        })
        .join("");

    // Featured Deep Dive (1st deep dive)
    const firstDive = (ed.deep_dives || [])[0];
    let featuredDiveHtml = "";
    if (firstDive) {
        const diveKey = registerClipItem(`front-dive-${firstDive.id || "0"}`, {
            title: firstDive.title,
            summary: firstDive.subtitle || (firstDive.body_paragraphs || [])[0] || "",
            content: (firstDive.body_paragraphs || []).join("\n\n"),
            url: ((firstDive.learn_more_links || [])[0] || {}).url || "",
            source: "The Daily Dispatch Feature",
            section: "curiosity",
            edition_date: ed.date,
        });
        const firstPara = (firstDive.body_paragraphs || [])[0] || "";
        featuredDiveHtml = `
            <div class="col-block" style="margin-top: 1.5rem; padding-top: 1.35rem; border-top: 3px double var(--np-rule-strong);">
                <span class="kicker-label kicker-gold">💡 WHAT YOU SHOULD LEARN TODAY • ${escapeHtml(firstDive.category || "CURIOSITY")}</span>
                <h2 class="deep-dive-title" style="font-size: 1.45rem;">${escapeHtml(firstDive.title)}</h2>
                <div class="deep-dive-sub">${escapeHtml(firstDive.subtitle || "")}</div>
                ${firstPara ? `<div class="editorial-prose"><p>${escapeHtml(firstPara)}</p></div>` : ""}
                <div class="article-actions">
                    <button type="button" class="np-action-btn primary-link" onclick="switchSection('curiosity')">Read Full Feature in 💡 Learn →</button>
                    <button type="button" class="np-action-btn" onclick="openClipModal('${diveKey}')">✂️ Clip</button>
                </div>
            </div>
        `;
    }

    // Garmin Athlete's Corner
    const g = ed.garmin_corner || {};
    const act = g.latest_activity;
    const garminCornerHtml = `
        <div class="sidebar-box">
            <span class="kicker-label">⚡ ATHLETE'S CORNER</span>
            ${g.readiness_score ? `
                <div class="garmin-corner-score">
                    <span class="garmin-score-num">${escapeHtml(g.readiness_score)}</span>
                    <span>${escapeHtml(g.readiness_category || "Readiness")}</span>
                </div>
            ` : ""}
            ${g.headline ? `<p style="font-size: 0.88rem; line-height: 1.45; margin-bottom: 0.5rem;">${escapeHtml(g.headline)}</p>` : ""}
            ${act ? `<div style="font-size: 0.8rem; color: var(--np-ink-muted); border-top: 1px solid var(--np-rule-soft); padding-top: 0.45rem; margin-top: 0.45rem;">
                Last Workout: <strong style="color: var(--np-ink-primary);">${escapeHtml(act.name)}</strong>
                ${act.distance_mi ? ` • ${escapeHtml(act.distance_mi)} mi` : ""}
                ${act.duration_min ? ` • ${escapeHtml(act.duration_min)}m` : ""}
            </div>` : `<div style="font-size: 0.82rem; color: var(--np-ink-muted);">Sync Garmin on the Fitness tab to populate your morning athlete brief.</div>`}
            <div style="margin-top: 0.6rem;">
                <a href="/fitness" class="np-action-btn primary-link">Open Fitness Tab →</a>
            </div>
        </div>
    `;

    // Wikipedia Featured & On This Day
    const wiki = ed.wikipedia || {};
    const tfa = wiki.featured_article;
    let wikiBoxHtml = "";
    if (tfa) {
        const tfaKey = registerClipItem("front-wiki-tfa", {
            title: tfa.title,
            summary: tfa.extract || "",
            content: tfa.extract || "",
            url: tfa.url || "",
            source: "Wikipedia Featured Article",
            section: "curiosity",
            edition_date: ed.date,
            image: tfa.image || "",
        });
        wikiBoxHtml = `
            <div class="sidebar-box sidebar-box-gold">
                <span class="kicker-label kicker-gold">📖 ENCYCLOPEDIA SPOTLIGHT</span>
                <h3 class="col-heading" style="font-size: 1.08rem;">${escapeHtml(tfa.title)}</h3>
                <p style="font-size: 0.86rem; line-height: 1.5; margin-bottom: 0.6rem;">${escapeHtml((tfa.extract || "").slice(0, 230))}${(tfa.extract || "").length > 230 ? "..." : ""}</p>
                <div class="article-actions">
                    <a href="${escapeHtml(tfa.url)}" target="_blank" rel="noopener noreferrer" class="np-action-btn primary-link">Wikipedia ↗</a>
                    <button type="button" class="np-action-btn" onclick="openClipModal('${tfaKey}')">✂️ Clip</button>
                </div>
            </div>
        `;
    }

    const otdItems = (wiki.on_this_day || [])
        .slice(0, 3)
        .map((ev) => `
            <li class="otd-item">
                <span class="otd-year">${escapeHtml(ev.year)}</span>
                <span>${escapeHtml(ev.text)}</span>
                ${ev.url ? `<a href="${escapeHtml(ev.url)}" target="_blank" rel="noopener noreferrer" style="color: var(--np-accent); margin-left: 0.3rem; text-decoration: none;">↗</a>` : ""}
            </li>
        `)
        .join("");

    canvas.innerHTML = `
        <div class="front-grid">
            <!-- Left Column -->
            <div class="front-col">
                <div class="col-block">
                    <span class="kicker-label kicker-gold">☕ MORNING EXECUTIVE BRIEFING</span>
                    <ul class="briefing-list">${briefingHtml}</ul>
                </div>

                ${ed.editorial_column && ed.editorial_column.title ? `
                <div class="col-block">
                    <span class="kicker-label">✍️ EDITOR'S NOTE</span>
                    <h3 class="col-heading">${escapeHtml(ed.editorial_column.title)}</h3>
                    <div class="editorial-prose">
                        <p style="font-size: 0.94rem;">${escapeHtml(ed.editorial_column.body || "")}</p>
                    </div>
                </div>` : ""}

                <div class="col-block">
                    <span class="kicker-label">📡 ABOVE THE FOLD WIRE</span>
                    ${wireItemsHtml}
                </div>
            </div>

            <!-- Center Column -->
            <div class="front-col">
                <div class="col-block" style="border-bottom: none; padding-bottom: 0;">
                    <span class="kicker-label">LEAD DISPATCH • ${escapeHtml(lead.section || "FRONT PAGE")}</span>
                    <h2 class="lead-story-headline">${escapeHtml(lead.headline || "Today's Top Story")}</h2>
                    <div class="lead-story-deck">${escapeHtml(lead.subheadline || "")}</div>
                    <div class="story-byline">
                        <span>${escapeHtml(lead.byline || "Editorial Desk")}</span>
                        <span>${escapeHtml(lead.dateline || "")}</span>
                    </div>
                    <div class="editorial-prose drop-cap">${leadBodyHtml}</div>
                    ${lead.why_it_matters ? `
                        <div class="why-matters-box">
                            <strong>Why It Matters</strong>
                            ${escapeHtml(lead.why_it_matters)}
                        </div>
                    ` : ""}
                    <div class="article-actions">
                        ${leadLinksHtml}
                        <button type="button" class="np-action-btn" onclick="openClipModal('${leadKey}')">✂️ Clip Lead Story</button>
                    </div>
                </div>

                ${featuredDiveHtml}
            </div>

            <!-- Right Column -->
            <div class="front-col">
                ${garminCornerHtml}
                ${wikiBoxHtml}

                ${otdItems ? `
                <div class="sidebar-box">
                    <span class="kicker-label">⏳ ON THIS DAY IN HISTORY</span>
                    <ul class="otd-list">${otdItems}</ul>
                </div>` : ""}
            </div>
        </div>
    `;
}

function renderTakeawaysBlock(takeaways) {
    if (!takeaways || !takeaways.length) return "";
    return `
        <div class="takeaways-list">
            <h4>Key Takeaways</h4>
            <ul>${takeaways.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>
        </div>
    `;
}

function renderNewsSectionPage(canvas, ed, secKey) {
    const sec = (ed.sections || {})[secKey];
    if (!sec) {
        canvas.innerHTML = `<div class="press-error">Section "${escapeHtml(secKey)}" not found in this edition.</div>`;
        return;
    }

    const cardsHtml = (sec.articles || [])
        .map((art, idx) => {
            const clipKey = registerClipItem(`sec-${secKey}-${idx}`, {
                title: art.title,
                summary: art.summary || "",
                content: art.why_it_matters ? `${art.summary}\n\nWhy It Matters: ${art.why_it_matters}` : art.summary,
                url: art.link || "",
                source: art.source || sec.title,
                section: secKey,
                edition_date: ed.date,
                image: art.image || "",
            });
            const voteKey = `${secKey}:${art.title}`;
            const currentVote = NP_STATE.votedMap[voteKey] || "";

            return `
                <article class="article-card">
                    <div>
                        <div class="article-meta-row">
                            <span class="source-badge">${escapeHtml(art.source || "Wire")}</span>
                            <span>${escapeHtml(formatRelativeTime(art.pub_date))}</span>
                        </div>
                        <h3 class="article-headline">
                            <a href="${escapeHtml(art.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(art.title)}</a>
                        </h3>
                        ${art.summary ? `<p class="article-summary">${escapeHtml(art.summary)}</p>` : ""}
                        ${art.why_it_matters ? `<div class="article-takeaway"><strong>Significance:</strong> ${escapeHtml(art.why_it_matters)}</div>` : ""}
                    </div>
                    <div class="article-actions">
                        <a href="${escapeHtml(art.link)}" target="_blank" rel="noopener noreferrer" class="np-action-btn primary-link">Read Full Story ↗</a>
                        <button type="button" class="np-action-btn" onclick="openClipModal('${clipKey}')">✂️ Clip</button>
                        <button type="button" class="np-action-btn ${currentVote === "like" ? "voted-up" : ""}" onclick="sendTopicFeedback('${escapeHtml(sec.title)}', '${clipKey}', 'like', this)" title="More like this">👍</button>
                        <button type="button" class="np-action-btn ${currentVote === "dislike" ? "voted-down" : ""}" onclick="sendTopicFeedback('${escapeHtml(sec.title)}', '${clipKey}', 'dislike', this)" title="Less like this">👎</button>
                    </div>
                </article>
            `;
        })
        .join("");

    canvas.innerHTML = `
        <div class="section-page-header">
            <span class="kicker-label">${escapeHtml(sec.kicker || secKey.toUpperCase())}</span>
            <h2 class="section-page-title">${escapeHtml(sec.title)}</h2>
            <p class="section-page-highlight">${escapeHtml(sec.highlight || sec.description || "")}</p>
        </div>
        ${cardsHtml ? `<div class="articles-broadsheet-grid">${cardsHtml}</div>` : `<div class="sidebar-box">No dispatches matched this section in today's pull. Try updating sources in Editorial Desk.</div>`}
    `;
}

function renderCuriosityPage(canvas, ed) {
    const divesHtml = (ed.deep_dives || [])
        .map((dive, idx) => {
            const diveKey = registerClipItem(`dive-${idx}-${dive.id || idx}`, {
                title: dive.title,
                summary: dive.subtitle || (dive.body_paragraphs || [])[0] || "",
                content: (dive.body_paragraphs || []).join("\n\n"),
                url: ((dive.learn_more_links || [])[0] || {}).url || "",
                source: "The Daily Dispatch Feature",
                section: "curiosity",
                edition_date: ed.date,
            });
            const voteKey = `curiosity:${dive.title}`;
            const currentVote = NP_STATE.votedMap[voteKey] || "";
            const topicTag = dive.topic_tag || dive.category || "Curiosity";

            return `
                <article class="deep-dive-card">
                    <span class="kicker-label kicker-gold">${escapeHtml(dive.category || "DEEP DIVE")} • ${escapeHtml(dive.reading_time || "3 min read")}</span>
                    <h3 class="deep-dive-title">${escapeHtml(dive.title)}</h3>
                    <div class="deep-dive-sub">${escapeHtml(dive.subtitle || "")}</div>
                    <div class="editorial-prose drop-cap">
                        ${(dive.body_paragraphs || []).map((p) => `<p>${escapeHtml(p)}</p>`).join("")}
                    </div>
                    ${renderTakeawaysBlock(dive.key_takeaways)}
                    <div class="article-actions">
                        ${(dive.learn_more_links || [])
                            .map((l) => `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer" class="np-action-btn primary-link">${escapeHtml(l.title || l.source || "Learn More")} ↗</a>`)
                            .join("")}
                        <button type="button" class="np-action-btn" onclick="openClipModal('${diveKey}')">✂️ Clip to Archive</button>
                        <button type="button" class="np-action-btn ${currentVote === "like" ? "voted-up" : ""}" onclick="sendTopicFeedback('${escapeHtml(topicTag)}', '${diveKey}', 'like', this)">👍 More like this</button>
                        <button type="button" class="np-action-btn ${currentVote === "dislike" ? "voted-down" : ""}" onclick="sendTopicFeedback('${escapeHtml(topicTag)}', '${diveKey}', 'dislike', this)">👎 Less</button>
                    </div>
                </article>
            `;
        })
        .join("");

    const wiki = ed.wikipedia || {};
    const tfa = wiki.featured_article;
    const tfaCardHtml = tfa ? (() => {
        const k = registerClipItem("curiosity-tfa", {
            title: tfa.title,
            summary: tfa.extract || "",
            content: tfa.extract || "",
            url: tfa.url || "",
            source: "Wikipedia Featured Article",
            section: "curiosity",
            edition_date: ed.date,
        });
        return `
            <article class="article-card" style="border-top-color: var(--np-gold);">
                <div>
                    <div class="article-meta-row">
                        <span class="source-badge" style="color: var(--np-gold); background: rgba(245,158,11,0.14);">Today's Featured</span>
                        <span>Wikipedia</span>
                    </div>
                    <h3 class="article-headline"><a href="${escapeHtml(tfa.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(tfa.title)}</a></h3>
                    ${tfa.image ? `<img src="${escapeHtml(tfa.image)}" alt="" class="article-thumb" loading="lazy">` : ""}
                    <p class="article-summary">${escapeHtml(tfa.extract || "")}</p>
                </div>
                <div class="article-actions">
                    <a href="${escapeHtml(tfa.url)}" target="_blank" rel="noopener noreferrer" class="np-action-btn primary-link">Read Wikipedia ↗</a>
                    <button type="button" class="np-action-btn" onclick="openClipModal('${k}')">✂️ Clip</button>
                </div>
            </article>
        `;
    })() : "";

    const randomCardsHtml = (wiki.random_articles || [])
        .map((r, i) => {
            const k = registerClipItem(`curiosity-rand-${i}`, {
                title: r.title,
                summary: r.extract || "",
                content: r.extract || "",
                url: r.url || "",
                source: "Wikipedia Random Discovery",
                section: "curiosity",
                edition_date: ed.date,
            });
            return `
                <article class="article-card">
                    <div>
                        <div class="article-meta-row">
                            <span class="source-badge">Random Rabbit Hole</span>
                            <span>${escapeHtml(r.description || "Encyclopedia")}</span>
                        </div>
                        <h3 class="article-headline"><a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.title)}</a></h3>
                        ${r.image ? `<img src="${escapeHtml(r.image)}" alt="" class="article-thumb" loading="lazy">` : ""}
                        <p class="article-summary">${escapeHtml(r.extract || "")}</p>
                    </div>
                    <div class="article-actions">
                        <a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer" class="np-action-btn primary-link">Explore Entry ↗</a>
                        <button type="button" class="np-action-btn" onclick="openClipModal('${k}')">✂️ Clip</button>
                    </div>
                </article>
            `;
        })
        .join("");

    const otdHtml = (wiki.on_this_day || [])
        .map((ev) => `
            <li class="otd-item">
                <span class="otd-year">${escapeHtml(ev.year)}</span>
                <span>${escapeHtml(ev.text)}</span>
                ${ev.url ? ` <a href="${escapeHtml(ev.url)}" target="_blank" rel="noopener noreferrer" style="color: var(--np-accent);">(${escapeHtml(ev.page_title || "Read")} ↗)</a>` : ""}
            </li>
        `)
        .join("");

    const mostReadHtml = (wiki.most_read || [])
        .map((m) => `
            <div class="wire-mini-item">
                <div class="wire-mini-sec">${m.views ? `${Number(m.views).toLocaleString()} views` : "Trending"} • ${escapeHtml(m.description || "Wikipedia")}</div>
                <a href="${escapeHtml(m.url)}" target="_blank" rel="noopener noreferrer" class="wire-mini-link">${escapeHtml(m.title)} ↗</a>
                <p style="font-size: 0.84rem; color: var(--np-ink-muted); margin-top: 0.2rem;">${escapeHtml(m.extract || "")}</p>
            </div>
        `)
        .join("");

    canvas.innerHTML = `
        <div class="section-page-header">
            <span class="kicker-label kicker-gold">SUNDAY SUPPLEMENT &amp; INTELLECTUAL DISCOVERY</span>
            <h2 class="section-page-title">💡 Curiosity &amp; Things Worth Learning</h2>
            <p class="section-page-highlight">Deep-dive explainers, serendipitous encyclopedia rabbit holes, and ideas beyond the daily news cycle.</p>
        </div>

        <div class="rabbit-hole-bar">
            <input type="text" id="rabbit-hole-input" class="rabbit-hole-input" placeholder="What do you want to learn about today? (e.g. How jet engines work, The Bronze Age Collapse, or leave blank to be surprised)" onkeydown="if(event.key==='Enter') generateDeepDive()">
            <button type="button" id="generate-dive-btn" class="suite-btn suite-btn-accent" onclick="generateDeepDive()">🔭 Generate Deep Dive</button>
        </div>

        <div style="margin-bottom: 2.25rem;">
            ${divesHtml || `<div class="sidebar-box">No deep dives generated yet. Click "Generate Deep Dive" above!</div>`}
        </div>

        <div class="section-page-header" style="display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 1rem;">
            <div>
                <span class="kicker-label">ENCYCLOPEDIA DESK</span>
                <h3 class="section-page-title" style="font-size: 1.6rem;">Wikipedia Discovery &amp; Historical Almanac</h3>
            </div>
            <button type="button" id="shuffle-wiki-btn" class="suite-btn" onclick="shuffleWikipedia()">🔀 Shuffle Random Articles</button>
        </div>

        <div class="articles-broadsheet-grid" style="margin-bottom: 2rem;">
            ${tfaCardHtml}
            ${randomCardsHtml}
        </div>

        <div class="extras-grid">
            ${otdHtml ? `<div class="sidebar-box"><span class="kicker-label kicker-gold">⏳ ON THIS DAY IN HISTORY</span><ul class="otd-list">${otdHtml}</ul></div>` : ""}
            ${mostReadHtml ? `<div class="sidebar-box"><span class="kicker-label">🔥 TRENDING ON WIKIPEDIA</span>${mostReadHtml}</div>` : ""}
        </div>
    `;
}

async function generateDeepDive() {
    const input = document.getElementById("rabbit-hole-input");
    const btn = document.getElementById("generate-dive-btn");
    const topic = input ? input.value.trim() : "";

    if (btn) {
        btn.disabled = true;
        btn.textContent = "⏳ Writing Feature...";
    }

    try {
        const resp = await fetch("/newspaper/api/deep_dive", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                topic,
                date: NP_STATE.edition ? NP_STATE.edition.date : "",
            }),
        });
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error(data.error || "Failed to generate deep dive");

        if (NP_STATE.edition) {
            NP_STATE.edition.deep_dives = [data.deep_dive, ...(NP_STATE.edition.deep_dives || [])];
        }
        if (input) input.value = "";
        renderCurrentSection();
        showToast(`New feature printed: ${data.deep_dive.title}`);
    } catch (err) {
        showToast(`Error: ${err.message}`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = "🔭 Generate Deep Dive";
        }
    }
}

async function shuffleWikipedia() {
    const btn = document.getElementById("shuffle-wiki-btn");
    if (btn) btn.disabled = true;
    try {
        const resp = await fetch("/newspaper/api/shuffle_wikipedia", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date: NP_STATE.edition ? NP_STATE.edition.date : "" }),
        });
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error(data.error || "Shuffle failed");
        if (NP_STATE.edition && data.random_articles) {
            NP_STATE.edition.wikipedia = NP_STATE.edition.wikipedia || {};
            NP_STATE.edition.wikipedia.random_articles = data.random_articles;
            renderCurrentSection();
        }
    } catch (err) {
        showToast(`Shuffle failed: ${err.message}`);
    } finally {
        if (btn) btn.disabled = false;
    }
}

function renderComicsPage(canvas, ed) {
    const comicsHtml = (ed.comics || [])
        .map((c, idx) => {
            const k = registerClipItem(`comic-${idx}-${c.id}`, {
                title: `${c.name}: ${c.title || "Daily Strip"}`,
                summary: c.alt || c.fallback_message || `Daily strip by ${c.creator}`,
                content: c.alt || "",
                url: c.url || "",
                source: c.name,
                section: "comics",
                edition_date: ed.date,
                image: c.image || "",
            });
            const hasImage = Boolean(c.image);
            return `
                <div class="comic-card">
                    <div class="article-meta-row">
                        <span class="source-badge">${escapeHtml(c.name)}</span>
                        <span>${escapeHtml(c.creator || "")}</span>
                    </div>
                    <h3 class="col-heading">${escapeHtml(c.title || c.name)}</h3>
                    ${hasImage ? `
                        <div class="comic-img-wrap">
                            <img src="${escapeHtml(c.image)}" alt="${escapeHtml(c.title || c.name)}" loading="lazy" onclick="openComicLightbox(${idx})" title="Click to enlarge comic strip">
                        </div>
                    ` : `
                        <div class="sidebar-box" style="margin: 0.75rem 0;">
                            <p style="font-size: 0.9rem; color: var(--np-ink-muted);">${escapeHtml(c.fallback_message || "Strip preview unavailable right now — try ↻ Reprint to retry.")}</p>
                        </div>
                    `}
                    ${c.alt ? `<div class="comic-alt-box"><strong>Hover Text:</strong> ${escapeHtml(c.alt)}</div>` : ""}
                    <div class="article-actions">
                        ${hasImage ? `<button type="button" class="np-action-btn primary-link" onclick="openComicLightbox(${idx})">🔍 Enlarge Strip</button>` : ""}
                        <button type="button" class="np-action-btn" onclick="openClipModal('${k}')">✂️ Clip</button>
                    </div>
                </div>
            `;
        })
        .join("");

    const extras = ed.daily_extras || {};
    const wotd = extras.word_of_the_day || {};
    const teaser = extras.brain_teaser || {};
    const quote = extras.quote_of_the_day || {};

    canvas.innerHTML = `
        <div class="section-page-header">
            <span class="kicker-label">SUNDAY FUNNIES &amp; PARLOR CORNER</span>
            <h2 class="section-page-title">🎨 Comics, Wordcraft &amp; Puzzles</h2>
            <p class="section-page-highlight">Take a breather with the daily strips, a word worth adding to your vocabulary, and today's riddle.</p>
        </div>

        <div class="comics-grid">${comicsHtml}</div>

        <div class="extras-grid">
            ${wotd.word ? `
            <div class="sidebar-box sidebar-box-gold">
                <span class="kicker-label kicker-gold">🔤 WORD OF THE DAY</span>
                <div style="font-family: var(--np-font-display); font-size: 1.65rem; font-weight: 800; color: var(--np-ink-primary);">${escapeHtml(wotd.word)}</div>
                <div style="font-family: var(--np-font-mono); font-size: 0.78rem; color: var(--np-ink-muted); margin: 0.25rem 0 0.65rem;">/${escapeHtml(wotd.pronunciation || "")}/ • ${escapeHtml(wotd.part_of_speech || "")}</div>
                <p style="font-size: 0.94rem; line-height: 1.5; margin-bottom: 0.55rem;">${escapeHtml(wotd.definition || "")}</p>
                ${wotd.example ? `<p style="font-style: italic; font-size: 0.88rem; color: var(--np-ink-muted); margin-bottom: 0.4rem;">"${escapeHtml(wotd.example)}"</p>` : ""}
                ${wotd.etymology ? `<p style="font-size: 0.8rem; color: var(--np-accent);">Origin: ${escapeHtml(wotd.etymology)}</p>` : ""}
            </div>` : ""}

            ${teaser.question ? `
            <div class="sidebar-box">
                <span class="kicker-label">🧩 DAILY BRAIN TEASER</span>
                <p style="font-size: 0.96rem; line-height: 1.55; margin: 0.5rem 0 0.85rem;">${escapeHtml(teaser.question)}</p>
                <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                    ${teaser.hint ? `<button type="button" class="np-action-btn" onclick="document.getElementById('teaser-hint-box').style.display='block'">Show Hint</button>` : ""}
                    <button type="button" class="np-action-btn primary-link" onclick="document.getElementById('teaser-ans-box').style.display='block'">Reveal Answer</button>
                </div>
                ${teaser.hint ? `<div id="teaser-hint-box" style="display:none; margin-top: 0.65rem; font-size: 0.86rem; color: var(--np-gold);"><strong>Hint:</strong> ${escapeHtml(teaser.hint)}</div>` : ""}
                <div id="teaser-ans-box" style="display:none; margin-top: 0.65rem; font-size: 0.9rem; color: var(--np-green);"><strong>Answer:</strong> ${escapeHtml(teaser.answer || "")}</div>
            </div>` : ""}

            ${quote.quote ? `
            <div class="sidebar-box">
                <span class="kicker-label">💬 QUOTE OF THE DAY</span>
                <blockquote style="font-family: var(--np-font-serif); font-size: 1.08rem; font-style: italic; line-height: 1.55; color: var(--np-ink-primary); margin: 0.5rem 0;">"${escapeHtml(quote.quote)}"</blockquote>
                <div style="font-weight: 600; color: var(--np-accent); font-size: 0.88rem;">— ${escapeHtml(quote.author || "")}</div>
                ${quote.context ? `<div style="font-size: 0.8rem; color: var(--np-ink-muted); margin-top: 0.25rem;">${escapeHtml(quote.context)}</div>` : ""}
            </div>` : ""}
        </div>
    `;
}

function openComicLightbox(idx) {
    const comics = (NP_STATE.edition && NP_STATE.edition.comics) || [];
    const c = comics[idx];
    if (!c || !c.image) return;

    let backdrop = document.getElementById("comic-lightbox-backdrop");
    if (!backdrop) {
        backdrop = document.createElement("div");
        backdrop.id = "comic-lightbox-backdrop";
        backdrop.className = "comic-lightbox-backdrop";
        backdrop.addEventListener("click", (e) => {
            if (e.target === backdrop) closeComicLightbox();
        });
        document.body.appendChild(backdrop);
    }

    backdrop.innerHTML = `
        <div class="comic-lightbox-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(c.title || c.name)}">
            <div class="comic-lightbox-header">
                <div>
                    <span class="source-badge">${escapeHtml(c.name || "")}</span>
                    <span style="margin-left: 0.5rem; font-weight: 700; color: var(--np-ink-primary);">${escapeHtml(c.title || c.name)}</span>
                </div>
                <button type="button" class="np-modal-close" onclick="closeComicLightbox()" aria-label="Close">✕</button>
            </div>
            <div class="comic-lightbox-img-wrap">
                <img src="${escapeHtml(c.image)}" alt="${escapeHtml(c.title || c.name)}" class="comic-lightbox-img">
            </div>
            ${c.alt ? `<div class="comic-alt-box" style="margin-top: 0.75rem; margin-bottom: 0;"><strong>Hover Text:</strong> ${escapeHtml(c.alt)}</div>` : ""}
        </div>
    `;
    backdrop.style.display = "flex";

    if (!window._npComicEscBound) {
        window._npComicEscBound = true;
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") closeComicLightbox();
        });
    }
}

function closeComicLightbox() {
    const backdrop = document.getElementById("comic-lightbox-backdrop");
    if (backdrop) backdrop.style.display = "none";
}

async function loadArchive(quiet = false) {
    try {
        const resp = await fetch("/newspaper/api/archive");
        if (!resp.ok) return;
        const data = await resp.json();
        NP_STATE.archive = {
            clips: data.clips || [],
            editions: data.editions || [],
        };

        const badge = document.getElementById("clip-count-badge");
        if (badge) badge.textContent = String(NP_STATE.archive.clips.length);

        const sel = document.getElementById("past-edition-select");
        if (sel) {
            const currentVal = NP_STATE.selectedDate || "";
            sel.innerHTML = `<option value="">Today's Edition</option>` + NP_STATE.archive.editions
                .map((e) => `<option value="${escapeHtml(e.date)}" ${e.date === currentVal ? "selected" : ""}>${e.archived ? "★ " : ""}${escapeHtml(e.date)} — ${escapeHtml((e.lead_headline || "").slice(0, 40))}</option>`)
                .join("");
        }

        if (!quiet && NP_STATE.currentSection === "archive") {
            const canvas = document.getElementById("newspaper-canvas");
            if (canvas) renderArchiveView(canvas);
        }
    } catch (err) {
        console.error("Archive load failed:", err);
    }
}

function renderArchiveView(canvas) {
    const sub = NP_STATE.archiveSubtab;
    const clips = NP_STATE.archive.clips || [];
    const editions = NP_STATE.archive.editions || [];

    const filteredClips = clips.filter((c) => {
        if (NP_STATE.clipSectionFilter !== "all" && c.section !== NP_STATE.clipSectionFilter) return false;
        if (NP_STATE.clipSearch) {
            const q = NP_STATE.clipSearch.toLowerCase();
            const hay = `${c.title} ${c.summary} ${c.notes} ${(c.tags || []).join(" ")} ${c.source}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });

    const clipsHtml = filteredClips
        .map((c) => {
            const isEditing = NP_STATE.editingClipId === c.id;
            return `
                <div class="clip-card">
                    <div class="article-meta-row">
                        <span class="source-badge">${escapeHtml(c.section || "clip")} • ${escapeHtml(c.source || "")}</span>
                        <span>Edition ${escapeHtml(c.edition_date || "")}</span>
                    </div>
                    <h3 class="article-headline" style="font-size: 1.3rem;">
                        ${c.url ? `<a href="${escapeHtml(c.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.title)}</a>` : escapeHtml(c.title)}
                    </h3>
                    ${c.image ? `<img src="${escapeHtml(c.image)}" alt="" class="article-thumb" style="max-height: 160px; width: auto;" loading="lazy">` : ""}
                    ${c.summary ? `<p class="article-summary">${escapeHtml(c.summary)}</p>` : ""}
                    ${isEditing ? `
                        <div style="margin-top: 0.75rem;">
                            <label class="np-field-label">Edit Notes</label>
                            <textarea id="edit-clip-notes-${escapeHtml(c.id)}" class="np-textarea" rows="2">${escapeHtml(c.notes || "")}</textarea>
                            <label class="np-field-label">Edit Tags (comma-separated)</label>
                            <input type="text" id="edit-clip-tags-${escapeHtml(c.id)}" class="np-input" value="${escapeHtml((c.tags || []).join(", "))}">
                            <div class="article-actions">
                                <button type="button" class="suite-btn suite-btn-accent" onclick="saveClipEdit('${escapeHtml(c.id)}')">Save</button>
                                <button type="button" class="suite-btn" onclick="NP_STATE.editingClipId=null; renderCurrentSection();">Cancel</button>
                            </div>
                        </div>
                    ` : `
                        ${c.notes ? `<div class="clip-notes-box"><strong>Notes:</strong> ${escapeHtml(c.notes)}</div>` : ""}
                        ${(c.tags && c.tags.length) ? `<div style="margin-top: 0.5rem;">${c.tags.map((t) => `<span class="tag-chip">#${escapeHtml(t)}</span>`).join("")}</div>` : ""}
                        <div class="article-actions">
                            ${c.url ? `<a href="${escapeHtml(c.url)}" target="_blank" rel="noopener noreferrer" class="np-action-btn primary-link">Open Link ↗</a>` : ""}
                            <button type="button" class="np-action-btn" onclick="NP_STATE.editingClipId='${escapeHtml(c.id)}'; renderCurrentSection();">✏️ Edit Notes/Tags</button>
                            <button type="button" class="np-action-btn" style="color: var(--np-red);" onclick="deleteClip('${escapeHtml(c.id)}')">🗑️ Delete</button>
                        </div>
                    `}
                </div>
            `;
        })
        .join("");

    const editionsHtml = editions
        .map((e) => `
            <div class="edition-row">
                <div>
                    <div class="article-meta-row" style="justify-content: flex-start; gap: 0.75rem;">
                        <span class="source-badge">${escapeHtml(e.date)}</span>
                        <span>${escapeHtml(e.issue_number || "")}</span>
                        <span>${e.article_count} stories • ${e.deep_dive_count} deep dives</span>
                    </div>
                    <div style="font-family: var(--np-font-display); font-size: 1.15rem; font-weight: 700; color: var(--np-ink-primary);">${escapeHtml(e.lead_headline)}</div>
                </div>
                <div style="display: flex; gap: 0.5rem; align-items: center;">
                    <button type="button" class="suite-btn ${e.archived ? "is-archived" : ""}" onclick="toggleArchiveEditionDate('${escapeHtml(e.date)}', ${!e.archived})">${e.archived ? "★ Saved" : "☆ Star"}</button>
                    <button type="button" class="suite-btn suite-btn-accent" onclick="openEditionFromArchive('${escapeHtml(e.date)}')">Open Edition</button>
                </div>
            </div>
        `)
        .join("");

    canvas.innerHTML = `
        <div class="section-page-header">
            <span class="kicker-label kicker-gold">PERSONAL LIBRARY &amp; BACK ISSUES</span>
            <h2 class="section-page-title">📚 Archive &amp; Clipping Vault</h2>
            <p class="section-page-highlight">Your saved clippings, personal margin notes, and complete past daily editions.</p>
        </div>

        <div class="archive-subtabs">
            <button type="button" class="suite-btn ${sub === "clips" ? "suite-btn-accent" : ""}" onclick="NP_STATE.archiveSubtab='clips'; renderCurrentSection();">✂️ Saved Clippings (${clips.length})</button>
            <button type="button" class="suite-btn ${sub === "editions" ? "suite-btn-accent" : ""}" onclick="NP_STATE.archiveSubtab='editions'; renderCurrentSection();">🗞️ Past Daily Editions (${editions.length})</button>
        </div>

        ${sub === "clips" ? `
            <div class="archive-filter-bar">
                <input type="text" class="np-input" style="max-width: 340px;" placeholder="Search clippings, notes, tags..." value="${escapeHtml(NP_STATE.clipSearch)}" oninput="NP_STATE.clipSearch=this.value; renderCurrentSection();">
                <select class="suite-select" onchange="NP_STATE.clipSectionFilter=this.value; renderCurrentSection();">
                    <option value="all" ${NP_STATE.clipSectionFilter === "all" ? "selected" : ""}>All Sections</option>
                    <option value="front" ${NP_STATE.clipSectionFilter === "front" ? "selected" : ""}>Front Page</option>
                    <option value="curiosity" ${NP_STATE.clipSectionFilter === "curiosity" ? "selected" : ""}>Curiosity &amp; Learn</option>
                    <option value="global" ${NP_STATE.clipSectionFilter === "global" ? "selected" : ""}>Global</option>
                    <option value="national" ${NP_STATE.clipSectionFilter === "national" ? "selected" : ""}>National</option>
                    <option value="politics" ${NP_STATE.clipSectionFilter === "politics" ? "selected" : ""}>Politics</option>
                    <option value="local" ${NP_STATE.clipSectionFilter === "local" ? "selected" : ""}>Local</option>
                    <option value="sports" ${NP_STATE.clipSectionFilter === "sports" ? "selected" : ""}>Sports</option>
                    <option value="scitech" ${NP_STATE.clipSectionFilter === "scitech" ? "selected" : ""}>Science &amp; Tech</option>
                    <option value="opinions" ${NP_STATE.clipSectionFilter === "opinions" ? "selected" : ""}>Opinions</option>
                    <option value="comics" ${NP_STATE.clipSectionFilter === "comics" ? "selected" : ""}>Comics</option>
                </select>
            </div>
            ${clipsHtml || `<div class="sidebar-box">No clippings match yet. Click <strong>✂️ Clip</strong> on any article, deep dive, or comic to save it here!</div>`}
        ` : `
            ${editionsHtml || `<div class="sidebar-box">No past editions cached yet.</div>`}
        `}
    `;
}

function openEditionFromArchive(dateStr) {
    switchSection("front");
    loadEdition(false, dateStr);
}

async function toggleArchiveCurrentEdition() {
    if (!NP_STATE.edition) return;
    await toggleArchiveEditionDate(NP_STATE.edition.date, !NP_STATE.edition.archived);
}

async function toggleArchiveEditionDate(dateStr, newArchivedState) {
    try {
        const resp = await fetch("/newspaper/api/edition/archive", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date: dateStr, archived: newArchivedState }),
        });
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error(data.error || "Failed to update edition archive flag");

        if (NP_STATE.edition && NP_STATE.edition.date === dateStr) {
            NP_STATE.edition.archived = data.archived;
            renderMasthead(NP_STATE.edition);
        }
        await loadArchive(false);
        showToast(data.archived ? `Edition ${dateStr} starred in Archive!` : `Removed star from ${dateStr}`);
    } catch (err) {
        showToast(`Error: ${err.message}`);
    }
}

function openClipModal(clipKey) {
    const item = NP_STATE.clipRegistry[clipKey];
    if (!item) return;
    NP_STATE.pendingClip = item;
    document.getElementById("clip-preview-meta").textContent = `${item.section || "dispatch"} • ${item.source || ""}`;
    document.getElementById("clip-preview-title").textContent = item.title || "";
    document.getElementById("clip-preview-summary").textContent = (item.summary || "").slice(0, 260);
    document.getElementById("clip-notes-input").value = "";
    document.getElementById("clip-tags-input").value = item.section || "";
    document.getElementById("clipModal").style.display = "flex";
}

function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
}

async function confirmSaveClip() {
    if (!NP_STATE.pendingClip) return;
    const notes = document.getElementById("clip-notes-input").value.trim();
    const tags = document.getElementById("clip-tags-input").value.trim();
    const payload = { ...NP_STATE.pendingClip, notes, tags };

    try {
        const resp = await fetch("/newspaper/api/clips", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error(data.error || "Failed to save clip");

        closeModal("clipModal");
        NP_STATE.pendingClip = null;
        await loadArchive(true);
        showToast("Clipped to your Archive Vault!");
    } catch (err) {
        showToast(`Error: ${err.message}`);
    }
}

async function saveClipEdit(clipId) {
    const notes = document.getElementById(`edit-clip-notes-${clipId}`).value;
    const tags = document.getElementById(`edit-clip-tags-${clipId}`).value;
    try {
        const resp = await fetch(`/newspaper/api/clips/${encodeURIComponent(clipId)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notes, tags }),
        });
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error(data.error || "Failed to update clip");
        NP_STATE.editingClipId = null;
        await loadArchive(false);
        showToast("Clipping updated.");
    } catch (err) {
        showToast(`Error: ${err.message}`);
    }
}

async function deleteClip(clipId) {
    try {
        const resp = await fetch(`/newspaper/api/clips/${encodeURIComponent(clipId)}`, { method: "DELETE" });
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error(data.error || "Delete failed");
        await loadArchive(false);
        showToast("Clipping deleted.");
    } catch (err) {
        showToast(`Error: ${err.message}`);
    }
}

async function sendTopicFeedback(topic, clipKey, sentiment, btnEl) {
    const item = NP_STATE.clipRegistry[clipKey] || {};
    try {
        const resp = await fetch("/newspaper/api/feedback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                topic,
                title: item.title || "",
                sentiment,
            }),
        });
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error(data.error || "Feedback failed");

        const voteKey = `${item.section || "curiosity"}:${item.title || ""}`;
        NP_STATE.votedMap[voteKey] = sentiment;
        if (btnEl && btnEl.parentElement) {
            btnEl.parentElement.querySelectorAll("button").forEach((b) => b.classList.remove("voted-up", "voted-down"));
            btnEl.classList.add(sentiment === "like" ? "voted-up" : "voted-down");
        }
        showToast(sentiment === "like" ? "Noted — we'll surface more topics like this!" : "Noted — we'll dial this topic down.");
    } catch (err) {
        showToast(`Feedback error: ${err.message}`);
    }
}

/* Editorial Desk Modal */
async function openEditorialDesk() {
    try {
        const resp = await fetch("/newspaper/api/settings");
        const s = await resp.json();
        NP_STATE.settings = s;

        document.getElementById("ed-masthead-title").value = s.masthead_title || "The Daily Dispatch";
        document.getElementById("ed-masthead-subtitle").value = s.masthead_subtitle || "";
        document.getElementById("ed-location").value = s.local_location || "";
        document.getElementById("ed-lat").value = s.weather_lat !== null && s.weather_lat !== undefined ? s.weather_lat : "";
        document.getElementById("ed-lon").value = s.weather_lon !== null && s.weather_lon !== undefined ? s.weather_lon : "";
        document.getElementById("ed-sports").value = (s.sports_interests || []).join(", ");
        document.getElementById("ed-curiosity").value = (s.curiosity_topics || []).join(", ");
        document.getElementById("ed-custom-prompt").value = s.custom_prompt || "";

        const enabledComics = new Set(s.enabled_comics || []);
        document.querySelectorAll(".ed-comic-cb").forEach((cb) => {
            cb.checked = enabledComics.has(cb.value);
        });

        renderCustomFeedsList();
        renderTasteChips();
        document.getElementById("editorialModal").style.display = "flex";
    } catch (err) {
        showToast(`Failed to load settings: ${err.message}`);
    }
}

function renderCustomFeedsList() {
    const container = document.getElementById("ed-custom-feeds-list");
    const feeds = (NP_STATE.settings && NP_STATE.settings.custom_rss_feeds) || [];
    if (!feeds.length) {
        container.innerHTML = `<div style="font-size: 0.82rem; color: var(--np-ink-muted);">No custom RSS feeds added yet.</div>`;
        return;
    }
    container.innerHTML = feeds
        .map(
            (f, idx) => `
            <div class="custom-feed-row">
                <span><strong>${escapeHtml(f.name)}</strong> (${escapeHtml(f.section)}) — <span style="color: var(--np-ink-muted);">${escapeHtml(f.url)}</span></span>
                <button type="button" class="np-action-btn" style="color: var(--np-red);" onclick="removeCustomFeed(${idx})">Remove</button>
            </div>
        `
        )
        .join("");
}

function addCustomFeedRow() {
    const name = document.getElementById("new-feed-name").value.trim();
    const url = document.getElementById("new-feed-url").value.trim();
    const section = document.getElementById("new-feed-section").value;
    if (!url) {
        showToast("Enter a valid RSS/Atom feed URL.");
        return;
    }
    NP_STATE.settings.custom_rss_feeds = NP_STATE.settings.custom_rss_feeds || [];
    NP_STATE.settings.custom_rss_feeds.push({ name: name || "Custom Feed", url, section });
    document.getElementById("new-feed-name").value = "";
    document.getElementById("new-feed-url").value = "";
    renderCustomFeedsList();
}

function removeCustomFeed(idx) {
    NP_STATE.settings.custom_rss_feeds.splice(idx, 1);
    renderCustomFeedsList();
}

function renderTasteChips() {
    const s = NP_STATE.settings || {};
    const likedEl = document.getElementById("ed-liked-chips");
    const dislikedEl = document.getElementById("ed-disliked-chips");

    const renderList = (arr, kind) => {
        if (!arr || !arr.length) return `<span style="font-size: 0.78rem; color: var(--np-ink-muted);">None</span>`;
        return arr
            .map(
                (t, idx) =>
                    `<span class="taste-chip">${escapeHtml(t)} <button type="button" onclick="removeTasteChip('${kind}', ${idx})">✕</button></span>`
            )
            .join("");
    };
    likedEl.innerHTML = renderList(s.liked_topics, "liked_topics");
    dislikedEl.innerHTML = renderList(s.disliked_topics, "disliked_topics");
}

function removeTasteChip(field, idx) {
    if (!NP_STATE.settings || !NP_STATE.settings[field]) return;
    NP_STATE.settings[field].splice(idx, 1);
    renderTasteChips();
}

async function saveEditorialDesk(reprintAfter = false) {
    const splitCsv = (val) =>
        val
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);

    const enabledComics = [];
    document.querySelectorAll(".ed-comic-cb:checked").forEach((cb) => enabledComics.push(cb.value));

    const payload = {
        masthead_title: document.getElementById("ed-masthead-title").value.trim() || "The Daily Dispatch",
        masthead_subtitle: document.getElementById("ed-masthead-subtitle").value.trim(),
        local_location: document.getElementById("ed-location").value.trim(),
        weather_lat: document.getElementById("ed-lat").value.trim() || null,
        weather_lon: document.getElementById("ed-lon").value.trim() || null,
        sports_interests: splitCsv(document.getElementById("ed-sports").value),
        curiosity_topics: splitCsv(document.getElementById("ed-curiosity").value),
        custom_prompt: document.getElementById("ed-custom-prompt").value.trim(),
        enabled_comics: enabledComics,
        custom_rss_feeds: (NP_STATE.settings && NP_STATE.settings.custom_rss_feeds) || [],
        liked_topics: (NP_STATE.settings && NP_STATE.settings.liked_topics) || [],
        disliked_topics: (NP_STATE.settings && NP_STATE.settings.disliked_topics) || [],
    };

    try {
        const resp = await fetch("/newspaper/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error(data.error || "Failed to save settings");

        closeModal("editorialModal");
        showToast("Editorial Desk settings saved!");
        if (reprintAfter) {
            loadEdition(true);
        }
    } catch (err) {
        showToast(`Error: ${err.message}`);
    }
}
