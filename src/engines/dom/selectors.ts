/**
 * XiaoHongShu DOM selectors — multi-candidate arrays, tried in order.
 * Ported from extension content.js v2.3.1 with Playwright adaptations.
 */

// Note detail page containers (tried in order, first match wins)
export const NOTE_CONTAINERS = [
  '#noteContainer',
  '.note-scroller',
  '.interaction-container',
  '.note-detail',
  '.note-content',
  '.content-container',
  '#detail-container',
  'article',
  'main',
];

// Title selectors (searched inside note container first)
export const NOTE_TITLE = [
  // Precise path: interaction-container > note-scroller > note-content > .title
  '.interaction-container .note-scroller .note-content .title',
  '.title',
  '.note-title',
  'h1',
];

// Body text selectors
export const NOTE_TEXT = [
  '.note-text',
  '#detail-desc .desc',
  '.content',
  '.note-content-item',
];

// Author selectors
export const NOTE_AUTHOR = [
  '.username',
  '.author .name',
  '.author-wrapper .name',
  '.user-name',
  '.nickname',
];

// Interaction bar selectors
export const INTERACTION_LEFT = '.left:has(.like-wrapper):has(.collect-wrapper):has(.chat-wrapper)';
export const LIKE_COUNT   = '.like-wrapper .count';
export const COLLECT_COUNT = '.collect-wrapper .count';
export const COMMENT_COUNT = '.chat-wrapper .count';

// Date selectors
export const NOTE_DATE = [
  '.date',
  '.publish-time',
  '.post-time',
  '.time',
  'span.date',
  'div.date',
  '[class*="date"]',
  '.bottom-container .date',
  '.note-content .date',
];

// Image selectors (note detail)
export const SWIPER_SLIDE = '.swiper-slide:not(.swiper-slide-duplicate)';
export const VIDEO_CONTAINER = '.player-container, .video-container';
export const VIDEO_POSTER = 'xg-poster';

// Interaction elements (for page-type detection)
export const HAS_NOTE_CONTAINER =
  '.note-container, .note-content-wrapper, .interaction-container, ' +
  '.main-content, .detail-container, .post-container';
export const HAS_INTERACTION =
  '.like-wrapper, .collect-wrapper, .chat-wrapper, ' +
  '.like-btn, .collect-btn, .comment-btn, .interaction-bar';

// ─── Search result page ────────────────────────────────────────────────────────

export const SEARCH_CARD = 'div.note-item, section.note-item, .note-item';
// Selectors tried per-card to find a note link
export const SEARCH_CARD_HREF_PATTERN = /\/(search_result|search\/result|explore|note|item)\//;
export const SEARCH_CARD_TITLE = '.title, .note-title, .desc, .content, .note-desc';
export const SEARCH_CARD_AUTHOR = '.author, .user-name, .nickname, .name';
export const SEARCH_CARD_LIKE = '.like-wrapper .count, .count';
export const SEARCH_CARD_VIDEO_MARKER = '.play-icon, .video-icon, [class*="video"]';
export const SEARCH_CARD_IMG = [
  'img[src*="xhscdn.com"], img[src*="xiaohongshu.com"], img[src*="xhsstatic.com"]',
  'img.cover-img, img.post-img, img.content-img, img[data-xhs-img]',
  '.img-container img, .cover-img-container img, .content-img-container img',
  'img',
];

// ─── Blogger profile page ─────────────────────────────────────────────────────

export const BLOGGER_PAGE_CHECK = '.user-page, .profile-page, .user-profile';
export const BLOGGER_AVATAR = [
  '.avatar img, .user-avatar img, .avatar-wrapper img, .user-image',
  'img[data-xhs-img=""]',
];
export const BLOGGER_NAME = [
  '.user-name, .nickname, .name, .user-nickname .user-name',
];
export const BLOGGER_BIO = [
  '.bio, .description, .intro, .user-bio, .user-desc',
];
export const BLOGGER_XHS_ID = [
  '.id, .user-id, .account-info .id, .user-redId',
];
export const BLOGGER_FOLLOWERS = [
  '.followers, .follower-count',
  '.user-interactions > div:nth-child(2) .count',
];

// ─── Blogger note feed (user profile page) ────────────────────────────────────

export const FEED_CARD = '#userPostedFeeds section, .note-item, .note-card, .feed-item, .feed-card, .note, .cover-item, .notes-item, article';
export const FEED_CARD_LINK = 'a[href*="/user/profile/"], a[href*="/discovery/"], a[href*="/note/"], a[href*="/item/"]';
export const FEED_CARD_IMG = [
  'img[src*="xhscdn.com"], img[src*="xiaohongshu.com"], img[src*="xhsstatic.com"]',
  'img.cover-img, img.post-img, img.content-img, img[data-xhs-img]',
  '.img-container img, .cover-img-container img, .content-img-container img',
  'img',
];
export const FEED_CARD_TITLE = '.title, .content-title, .note-title, .desc, .content, .note-desc, .note-content';
export const FEED_CARD_AUTHOR = '.author span, .user-name, .nickname, .name';

// ─── Comment section ─────────────────────────────────────────────────────────

export const COMMENT_SECTION = [
  '.comments-container',
  '.comment-container',
  '.comments-section',
  '.interact-comment',
  '.comment-list',
  '#noteContainer .comments',
];

export const COMMENT_ITEM = [
  '.comment-item',
  '.comment-inner-container',
  '.parent-comment',
  '.comment',
];

export const COMMENT_CONTENT = [
  '.comment-content .note-text',
  '.comment-content',
  '.comment-text',
  '.content',
];

export const COMMENT_AUTHOR = [
  '.comment-user .author-name',
  '.comment-item .author-name',
  '.comment-author',
  '.author-name',
  '.user-name',
  '.username',
];

export const COMMENT_TIME = [
  '.comment-time',
  '.time',
  '.date',
  '.timestamp',
];

export const COMMENT_LIKE = [
  '.comment-like .count',
  '.like-wrapper .count',
  '.count',
];

export const COMMENT_REPLY_ITEM = [
  '.reply-item',
  '.sub-comment-item',
  '.sub-comment',
  '.reply',
];

export const COMMENT_SHOW_MORE = [
  '.show-more',
  '.view-more-comment',
  '.expand-reply',
  '[class*="show-more"]',
  'span:has-text("展开更多")',
];

// ─── Captcha detection ────────────────────────────────────────────────────────

export const CAPTCHA_OVERLAY = [
  '.captcha-verify',
  '.captcha-dialog',
  '#captcha',
  '[class*="captcha"]',
  '.verify-container',
];
