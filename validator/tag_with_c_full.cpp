/**
 * tag_with_c_full.cpp
 *
 * Tags an audio file using C TagLib with a fixed set of tags and a picture.
 * Used for bidirectional cross-validation with taglib-ts.
 *
 * Usage: tag_with_c_full <input> <output> <format>
 *   format: mp3, flac, ogg, oggflac, opus, speex, m4a, wav, aiff, mpc, wv, ape, tta, dsf, dff, asf, mkv
 *         + extended-tag variants: mp3-ext, flac-ext, ogg-ext, oggflac-ext, opus-ext, speex-ext,
 *             m4a-ext, wav-ext, aiff-ext, mpc-ext, wv-ext, ape-ext, tta-ext, dsf-ext, dff-ext,
 *             asf-ext, mkv-ext
 *         + chapter variants: mp3-chap, wav-chap, aiff-chap, tta-chap, dsf-chap, dff-chap,
 *             m4a-nero, m4a-qt, mkv-chap
 *
 * Tags written (UTF-8 encoded Unicode strings including CJK characters):
 *   Basic 7:
 *     title   = "Unicode テスト"
 *     artist  = "音楽 Artist"
 *     album   = "日本語 Album"
 *     comment = "コメント Comment"
 *     genre   = "Electronic"
 *     year    = 2025
 *     track   = 7
 *   Extended (for -ext and -chap variants):
 *     ALBUMARTIST = "アルバムアーティスト"
 *     COMPOSER    = "Composer 作曲家"
 *     DISCNUMBER  = "1"
 *   Chapters (for -chap / m4a-nero / m4a-qt / mkv-chap variants):
 *     Ch1: title="第一章", startTime=0 ms
 *     Ch2: title="第二章", startTime=30000 ms
 *   + one JPEG picture of 512 bytes (for formats that support it)
 */
#include <algorithm>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

#include <taglib/aifffile.h>
#include <taglib/apefile.h>
#include <taglib/apetag.h>
#include <taglib/asffile.h>
#include <taglib/asfpicture.h>
#include <taglib/asftag.h>
#include <taglib/attachedpictureframe.h>
#include <taglib/chapterframe.h>
#include <taglib/dsdifffile.h>
#include <taglib/dsffile.h>
#include <taglib/fileref.h>
#include <taglib/flacfile.h>
#include <taglib/flacpicture.h>
#include <taglib/id3v2tag.h>
#include <taglib/matroskachapter.h>
#include <taglib/matroskachapteredition.h>
#include <taglib/matroskachapters.h>
#include <taglib/matroskafile.h>
#include <taglib/mp4chapter.h>
#include <taglib/mp4coverart.h>
#include <taglib/mp4file.h>
#include <taglib/mp4tag.h>
#include <taglib/mpcfile.h>
#include <taglib/mpegfile.h>
#include <taglib/oggflacfile.h>
#include <taglib/opusfile.h>
#include <taglib/speexfile.h>
#include <taglib/tableofcontentsframe.h>
#include <taglib/tag.h>
#include <taglib/tpropertymap.h>
#include <taglib/textidentificationframe.h>
#include <taglib/trueaudiofile.h>
#include <taglib/vorbisfile.h>
#include <taglib/wavfile.h>
#include <taglib/wavpackfile.h>
#include <taglib/xiphcomment.h>
#include <taglib/id3v2framefactory.h>

namespace fs = std::filesystem;

static std::string toLower(std::string s) {
  std::transform(s.begin(), s.end(), s.begin(), ::tolower);
  return s;
}

// ---------------------------------------------------------------------------
// Tag value constants
// ---------------------------------------------------------------------------

// Basic 7 tags (UTF-8, includes CJK characters)
static constexpr const char *TITLE   = "Unicode テスト";    // CJK katakana
static constexpr const char *ARTIST  = "音楽 Artist";       // CJK kanji
static constexpr const char *ALBUM   = "日本語 Album";      // CJK kanji
static constexpr const char *COMMENT = "コメント Comment";  // CJK katakana
static constexpr const char *GENRE   = "Electronic";
static constexpr unsigned int YEAR   = 2025;
static constexpr unsigned int TRACK  = 7;

// Extended tags (UTF-8 Unicode)
static constexpr const char *ALBUMARTIST = "アルバムアーティスト"; // all katakana
static constexpr const char *COMPOSER    = "Composer 作曲家";      // Latin + CJK
static constexpr const char *DISCNUMBER  = "1";

// Chapter data (UTF-8 Unicode titles, times in milliseconds)
static constexpr const char *CHAP1_TITLE = "第一章";  // "Chapter One" in Japanese
static constexpr const char *CHAP2_TITLE = "第二章";  // "Chapter Two" in Japanese
static constexpr unsigned int CHAP1_START = 0;
static constexpr unsigned int CHAP1_END   = 30000;
static constexpr unsigned int CHAP2_START = 30000;
static constexpr unsigned int CHAP2_END   = 60000;

// Matroska chapter times are in nanoseconds
static constexpr unsigned long long CHAP1_START_NS = 0ULL;
static constexpr unsigned long long CHAP1_END_NS   = 30000000000ULL;  // 30s
static constexpr unsigned long long CHAP2_START_NS = 30000000000ULL;
static constexpr unsigned long long CHAP2_END_NS   = 60000000000ULL;  // 60s

// ---------------------------------------------------------------------------
// Picture / tag helpers
// ---------------------------------------------------------------------------

// Create a deterministic JPEG-like buffer (starts with FF D8)
static TagLib::ByteVector makeFakeJPEG(int size = 512) {
  TagLib::ByteVector data(size, '\x00');
  if (size >= 2) {
    data[0] = static_cast<char>(0xFF);
    data[1] = static_cast<char>(0xD8);
  }
  for (int i = 2; i < size; i++) {
    data[i] = static_cast<char>((i * 37 + 13) & 0xFF);
  }
  return data;
}

static TagLib::FLAC::Picture *makeFLACPicture() {
  auto *pic = new TagLib::FLAC::Picture();
  pic->setType(TagLib::FLAC::Picture::FrontCover);
  pic->setMimeType("image/jpeg");
  pic->setDescription("Front Cover");
  pic->setWidth(0);
  pic->setHeight(0);
  pic->setColorDepth(0);
  pic->setNumColors(0);
  pic->setData(makeFakeJPEG());
  return pic;
}

static TagLib::ID3v2::AttachedPictureFrame *makeAPICFrame() {
  auto *apic = new TagLib::ID3v2::AttachedPictureFrame();
  apic->setTextEncoding(TagLib::String::UTF8);
  apic->setMimeType("image/jpeg");
  apic->setType(TagLib::ID3v2::AttachedPictureFrame::FrontCover);
  apic->setDescription("Front Cover");
  apic->setPicture(makeFakeJPEG());
  return apic;
}

/** Apply the basic 7 tags to any tag via the generic Tag interface. */
static void applyBasicTags(TagLib::Tag *tag) {
  tag->setTitle(TagLib::String(TITLE, TagLib::String::UTF8));
  tag->setArtist(TagLib::String(ARTIST, TagLib::String::UTF8));
  tag->setAlbum(TagLib::String(ALBUM, TagLib::String::UTF8));
  tag->setComment(TagLib::String(COMMENT, TagLib::String::UTF8));
  tag->setGenre(TagLib::String(GENRE, TagLib::String::UTF8));
  tag->setYear(YEAR);
  tag->setTrack(TRACK);
}

/**
 * Apply extended tags (ALBUMARTIST, COMPOSER, DISCNUMBER) via the generic
 * PropertyMap interface.  Works for ID3v2, XiphComment, MP4, ASF, and any
 * other tag type that implements setProperties().
 *
 * NOTE: for Matroska, setProperties() is destructive (it removes ALL
 * translatable simple-tags and re-adds only the ones in the passed map).
 * Do NOT call this function on a Matroska file after applyBasicTags(); use
 * applyAllTagsMatroska() instead.
 */
static void applyExtendedTagsViaProps(TagLib::Tag *tag) {
  TagLib::PropertyMap props;
  props["ALBUMARTIST"].append(TagLib::String(ALBUMARTIST, TagLib::String::UTF8));
  props["COMPOSER"].append(TagLib::String(COMPOSER, TagLib::String::UTF8));
  props["DISCNUMBER"].append(TagLib::String(DISCNUMBER));
  tag->setProperties(props);
}

/**
 * Apply extended tags directly to an APEv2 tag using the item-level API
 * (addValue), bypassing setProperties() key translation.
 *
 * C++ TagLib's APETag::setProperties() remaps "ALBUMARTIST" -> "ALBUM ARTIST"
 * and "DISCNUMBER" -> "DISC".  taglib-ts writes those fields as "ALBUMARTIST"
 * and "DISCNUMBER" directly.  To produce byte-identical output we use the
 * same key names as taglib-ts.
 */
static void applyExtendedAPETags(TagLib::APE::Tag *apeTag) {
  apeTag->addValue(TagLib::String("ALBUMARTIST"),
                   TagLib::String(ALBUMARTIST, TagLib::String::UTF8));
  apeTag->addValue(TagLib::String("COMPOSER"),
                   TagLib::String(COMPOSER, TagLib::String::UTF8));
  apeTag->addValue(TagLib::String("DISCNUMBER"),
                   TagLib::String(DISCNUMBER));
}

/**
 * Apply ALL tags (basic 7 + extended 3) to any tag via a single setProperties()
 * call.  Keys are inserted in alphabetical order so that tag types backed by
 * std::map (e.g. ID3v2, XiphComment, MP4, ASF) render properties in the same
 * sorted order in both C++ and TypeScript, ensuring byte-identical output.
 *
 * Do NOT use this for APEv2 tags (MPC, WavPack, APE): those use the additive
 * applyBasicTags + applyExtendedAPETags helpers instead.
 */
static void applyAllTagsViaProps(TagLib::Tag *tag) {
  TagLib::PropertyMap all;
  all["ALBUM"].append(TagLib::String(ALBUM, TagLib::String::UTF8));
  all["ALBUMARTIST"].append(TagLib::String(ALBUMARTIST, TagLib::String::UTF8));
  all["ARTIST"].append(TagLib::String(ARTIST, TagLib::String::UTF8));
  all["COMMENT"].append(TagLib::String(COMMENT, TagLib::String::UTF8));
  all["COMPOSER"].append(TagLib::String(COMPOSER, TagLib::String::UTF8));
  all["DATE"].append(TagLib::String(std::to_string(YEAR)));
  all["DISCNUMBER"].append(TagLib::String(DISCNUMBER));
  all["GENRE"].append(TagLib::String(GENRE, TagLib::String::UTF8));
  all["TITLE"].append(TagLib::String(TITLE, TagLib::String::UTF8));
  all["TRACKNUMBER"].append(TagLib::String(std::to_string(TRACK)));
  tag->setProperties(all);
}

/**
 * Apply ALL tags to a Matroska file.  Delegates to applyAllTagsViaProps()
 * since Matroska::Tag::setProperties() is also destructive.
 */
static void applyAllTagsMatroska(TagLib::Tag *tag) {
  applyAllTagsViaProps(tag);
}

// ---------------------------------------------------------------------------
// Chapter helpers
// ---------------------------------------------------------------------------

/** Add a two-entry CTOC + two CHAP frames to an ID3v2 tag. */
static void addID3v2Chapters(TagLib::ID3v2::Tag *id3) {
  // CTOC (Table of Contents)
  auto *ctoc = new TagLib::ID3v2::TableOfContentsFrame(
      TagLib::ByteVector("toc", 3));
  ctoc->setIsTopLevel(true);
  ctoc->setIsOrdered(true);
  ctoc->addChildElement(TagLib::ByteVector("ch1", 3));
  ctoc->addChildElement(TagLib::ByteVector("ch2", 3));
  id3->addFrame(ctoc);

  // Chapter 1
  auto *chap1 = new TagLib::ID3v2::ChapterFrame(
      TagLib::ByteVector("ch1", 3),
      CHAP1_START, CHAP1_END, 0xFFFFFFFF, 0xFFFFFFFF);
  auto *tit1 = new TagLib::ID3v2::TextIdentificationFrame("TIT2", TagLib::String::UTF8);
  tit1->setText(TagLib::String(CHAP1_TITLE, TagLib::String::UTF8));
  chap1->addEmbeddedFrame(tit1);
  id3->addFrame(chap1);

  // Chapter 2
  auto *chap2 = new TagLib::ID3v2::ChapterFrame(
      TagLib::ByteVector("ch2", 3),
      CHAP2_START, CHAP2_END, 0xFFFFFFFF, 0xFFFFFFFF);
  auto *tit2 = new TagLib::ID3v2::TextIdentificationFrame("TIT2", TagLib::String::UTF8);
  tit2->setText(TagLib::String(CHAP2_TITLE, TagLib::String::UTF8));
  chap2->addEmbeddedFrame(tit2);
  id3->addFrame(chap2);
}

/** Add two Nero-style (chpl atom) chapters to an MP4 file. */
static void addNeroChapters(TagLib::MP4::File &f) {
  TagLib::MP4::ChapterList chapters;
  chapters.append(TagLib::MP4::Chapter(
      TagLib::String(CHAP1_TITLE, TagLib::String::UTF8), CHAP1_START));
  chapters.append(TagLib::MP4::Chapter(
      TagLib::String(CHAP2_TITLE, TagLib::String::UTF8), CHAP2_START));
  f.setNeroChapters(chapters);
}

/** Add two QuickTime-style (text track) chapters to an MP4 file. */
static void addQtChapters(TagLib::MP4::File &f) {
  TagLib::MP4::ChapterList chapters;
  chapters.append(TagLib::MP4::Chapter(
      TagLib::String(CHAP1_TITLE, TagLib::String::UTF8), CHAP1_START));
  chapters.append(TagLib::MP4::Chapter(
      TagLib::String(CHAP2_TITLE, TagLib::String::UTF8), CHAP2_START));
  f.setQtChapters(chapters);
}

/** Add two chapters to a Matroska file (times in nanoseconds). */
static void addMatroskaChapters(TagLib::Matroska::File &f) {
  TagLib::List<TagLib::Matroska::Chapter::Display> d1;
  d1.append(TagLib::Matroska::Chapter::Display(
      TagLib::String(CHAP1_TITLE, TagLib::String::UTF8),
      TagLib::String("und")));
  TagLib::List<TagLib::Matroska::Chapter::Display> d2;
  d2.append(TagLib::Matroska::Chapter::Display(
      TagLib::String(CHAP2_TITLE, TagLib::String::UTF8),
      TagLib::String("und")));

  TagLib::List<TagLib::Matroska::Chapter> chList;
  chList.append(TagLib::Matroska::Chapter(CHAP1_START_NS, CHAP1_END_NS, d1, 1ULL));
  chList.append(TagLib::Matroska::Chapter(CHAP2_START_NS, CHAP2_END_NS, d2, 2ULL));

  TagLib::Matroska::ChapterEdition edition(chList, true, false, 0ULL);
  f.chapters(true)->addChapterEdition(edition);
}

// ---------------------------------------------------------------------------
// Format-specific tag writers — basic tags only
// ---------------------------------------------------------------------------

static bool tagMP3(const std::string &path) {
  TagLib::MPEG::File f(path.c_str());
  if (!f.isValid()) return false;
  applyBasicTags(f.ID3v2Tag(true));
  f.ID3v2Tag(true)->addFrame(makeAPICFrame());
  return f.save(TagLib::MPEG::File::ID3v2, TagLib::File::StripOthers,
                TagLib::ID3v2::v4);
}

static bool tagFLAC(const std::string &path) {
  TagLib::FLAC::File f(path.c_str());
  if (!f.isValid()) return false;
  applyBasicTags(f.tag());
  f.removePictures();
  f.addPicture(makeFLACPicture());
  return f.save();
}

static bool tagOGGVorbis(const std::string &path) {
  TagLib::Ogg::Vorbis::File f(path.c_str());
  if (!f.isValid() || !f.tag()) return false;
  applyBasicTags(f.tag());
  f.tag()->removeAllPictures();
  f.tag()->addPicture(makeFLACPicture());
  return f.save();
}

static bool tagOGGOpus(const std::string &path) {
  TagLib::Ogg::Opus::File f(path.c_str());
  if (!f.isValid() || !f.tag()) return false;
  applyBasicTags(f.tag());
  f.tag()->removeAllPictures();
  f.tag()->addPicture(makeFLACPicture());
  return f.save();
}

static bool tagOGGSpeex(const std::string &path) {
  TagLib::Ogg::Speex::File f(path.c_str());
  if (!f.isValid() || !f.tag()) return false;
  applyBasicTags(f.tag());
  f.tag()->removeAllPictures();
  f.tag()->addPicture(makeFLACPicture());
  return f.save();
}

static bool tagMP4(const std::string &path) {
  TagLib::MP4::File f(path.c_str());
  if (!f.isValid() || !f.tag()) return false;
  applyBasicTags(f.tag());
  TagLib::MP4::CoverArt cover(TagLib::MP4::CoverArt::JPEG, makeFakeJPEG());
  TagLib::MP4::CoverArtList list;
  list.append(cover);
  f.tag()->setItem("covr", list);
  return f.save();
}

static bool tagWAV(const std::string &path) {
  TagLib::RIFF::WAV::File f(path.c_str());
  if (!f.isValid()) return false;
  applyBasicTags(f.ID3v2Tag());
  f.ID3v2Tag()->addFrame(makeAPICFrame());
  return f.save();
}

static bool tagAIFF(const std::string &path) {
  TagLib::RIFF::AIFF::File f(path.c_str());
  if (!f.isValid() || !f.tag()) return false;
  applyBasicTags(f.tag());
  f.tag()->addFrame(makeAPICFrame());
  return f.save();
}

static bool tagMPC(const std::string &path) {
  TagLib::MPC::File f(path.c_str());
  if (!f.isValid()) return false;
  applyBasicTags(f.APETag(true));
  return f.save();
}

static bool tagWavPack(const std::string &path) {
  TagLib::WavPack::File f(path.c_str());
  if (!f.isValid()) return false;
  applyBasicTags(f.APETag(true));
  return f.save();
}

static bool tagAPE(const std::string &path) {
  TagLib::APE::File f(path.c_str());
  if (!f.isValid()) return false;
  applyBasicTags(f.APETag(true));
  return f.save();
}

static bool tagTTA(const std::string &path) {
  TagLib::TrueAudio::File f(path.c_str());
  if (!f.isValid()) return false;
  applyBasicTags(f.ID3v2Tag(true));
  f.ID3v2Tag(true)->addFrame(makeAPICFrame());
  return f.save();
}

static bool tagDSF(const std::string &path) {
  TagLib::DSF::File f(path.c_str());
  if (!f.isValid()) return false;
  applyBasicTags(f.tag());
  f.tag()->addFrame(makeAPICFrame());
  return f.save();
}

static bool tagDSDIFF(const std::string &path) {
  TagLib::DSDIFF::File f(path.c_str());
  if (!f.isValid()) return false;
  applyBasicTags(f.tag());
  f.ID3v2Tag(true)->addFrame(makeAPICFrame());
  return f.save();
}

static bool tagOGGFlac(const std::string &path) {
  TagLib::Ogg::FLAC::File f(path.c_str());
  if (!f.isValid()) return false;
  applyBasicTags(f.tag());
  f.tag()->removeAllPictures();
  f.tag()->addPicture(makeFLACPicture());
  return f.save();
}

static bool tagASF(const std::string &path) {
  TagLib::ASF::File f(path.c_str());
  if (!f.isValid() || !f.tag()) return false;
  applyBasicTags(f.tag());
  TagLib::ASF::Picture pic;
  pic.setType(TagLib::ASF::Picture::FrontCover);
  pic.setMimeType("image/jpeg");
  pic.setDescription("Front Cover");
  pic.setPicture(makeFakeJPEG());
  f.tag()->setAttribute("WM/Picture", TagLib::ASF::Attribute(pic));
  return f.save();
}

static bool tagMatroska(const std::string &path) {
  TagLib::Matroska::File f(path.c_str());
  if (!f.isValid()) return false;
  applyBasicTags(f.tag());
  return f.save();
}

// ---------------------------------------------------------------------------
// Format-specific tag writers — basic + extended tags
// ---------------------------------------------------------------------------

static bool tagMP3Ext(const std::string &path) {
  TagLib::MPEG::File f(path.c_str());
  if (!f.isValid()) return false;
  applyAllTagsViaProps(f.ID3v2Tag(true));
  f.ID3v2Tag(true)->addFrame(makeAPICFrame());
  return f.save(TagLib::MPEG::File::ID3v2, TagLib::File::StripOthers,
                TagLib::ID3v2::v4);
}

static bool tagFLACExt(const std::string &path) {
  TagLib::FLAC::File f(path.c_str());
  if (!f.isValid()) return false;
  applyAllTagsViaProps(f.xiphComment(true));
  f.removePictures();
  f.addPicture(makeFLACPicture());
  return f.save();
}

static bool tagOGGVorbisExt(const std::string &path) {
  TagLib::Ogg::Vorbis::File f(path.c_str());
  if (!f.isValid() || !f.tag()) return false;
  applyAllTagsViaProps(f.tag());
  f.tag()->removeAllPictures();
  f.tag()->addPicture(makeFLACPicture());
  return f.save();
}

static bool tagOGGOpusExt(const std::string &path) {
  TagLib::Ogg::Opus::File f(path.c_str());
  if (!f.isValid() || !f.tag()) return false;
  applyAllTagsViaProps(f.tag());
  f.tag()->removeAllPictures();
  f.tag()->addPicture(makeFLACPicture());
  return f.save();
}

static bool tagOGGSpeexExt(const std::string &path) {
  TagLib::Ogg::Speex::File f(path.c_str());
  if (!f.isValid() || !f.tag()) return false;
  applyAllTagsViaProps(f.tag());
  f.tag()->removeAllPictures();
  f.tag()->addPicture(makeFLACPicture());
  return f.save();
}

static bool tagMP4Ext(const std::string &path) {
  TagLib::MP4::File f(path.c_str());
  if (!f.isValid() || !f.tag()) return false;
  applyAllTagsViaProps(f.tag());
  TagLib::MP4::CoverArt cover(TagLib::MP4::CoverArt::JPEG, makeFakeJPEG());
  TagLib::MP4::CoverArtList list;
  list.append(cover);
  f.tag()->setItem("covr", list);
  return f.save();
}

static bool tagWAVExt(const std::string &path) {
  TagLib::RIFF::WAV::File f(path.c_str());
  if (!f.isValid()) return false;
  applyAllTagsViaProps(f.ID3v2Tag());
  f.ID3v2Tag()->addFrame(makeAPICFrame());
  return f.save();
}

static bool tagAIFFExt(const std::string &path) {
  TagLib::RIFF::AIFF::File f(path.c_str());
  if (!f.isValid() || !f.tag()) return false;
  applyAllTagsViaProps(f.tag());
  f.tag()->addFrame(makeAPICFrame());
  return f.save();
}

static bool tagMPCExt(const std::string &path) {
  TagLib::MPC::File f(path.c_str());
  if (!f.isValid()) return false;
  applyBasicTags(f.APETag(true));
  applyExtendedAPETags(f.APETag(true));
  return f.save();
}

static bool tagWavPackExt(const std::string &path) {
  TagLib::WavPack::File f(path.c_str());
  if (!f.isValid()) return false;
  applyBasicTags(f.APETag(true));
  applyExtendedAPETags(f.APETag(true));
  return f.save();
}

static bool tagAPEExt(const std::string &path) {
  TagLib::APE::File f(path.c_str());
  if (!f.isValid()) return false;
  applyBasicTags(f.APETag(true));
  applyExtendedAPETags(f.APETag(true));
  return f.save();
}

static bool tagTTAExt(const std::string &path) {
  TagLib::TrueAudio::File f(path.c_str());
  if (!f.isValid()) return false;
  applyAllTagsViaProps(f.ID3v2Tag(true));
  f.ID3v2Tag(true)->addFrame(makeAPICFrame());
  return f.save();
}

static bool tagDSFExt(const std::string &path) {
  TagLib::DSF::File f(path.c_str());
  if (!f.isValid()) return false;
  applyAllTagsViaProps(f.tag());
  f.tag()->addFrame(makeAPICFrame());
  return f.save();
}

static bool tagDSDIFFExt(const std::string &path) {
  TagLib::DSDIFF::File f(path.c_str());
  if (!f.isValid()) return false;
  applyAllTagsViaProps(f.ID3v2Tag(true));
  f.ID3v2Tag(true)->addFrame(makeAPICFrame());
  return f.save();
}

static bool tagOGGFlacExt(const std::string &path) {
  TagLib::Ogg::FLAC::File f(path.c_str());
  if (!f.isValid()) return false;
  applyAllTagsViaProps(f.tag());
  f.tag()->removeAllPictures();
  f.tag()->addPicture(makeFLACPicture());
  return f.save();
}

static bool tagASFExt(const std::string &path) {
  TagLib::ASF::File f(path.c_str());
  if (!f.isValid() || !f.tag()) return false;
  applyAllTagsViaProps(f.tag());
  TagLib::ASF::Picture pic;
  pic.setType(TagLib::ASF::Picture::FrontCover);
  pic.setMimeType("image/jpeg");
  pic.setDescription("Front Cover");
  pic.setPicture(makeFakeJPEG());
  f.tag()->setAttribute("WM/Picture", TagLib::ASF::Attribute(pic));
  return f.save();
}

static bool tagMatroskaExt(const std::string &path) {
  TagLib::Matroska::File f(path.c_str());
  if (!f.isValid()) return false;
  applyAllTagsMatroska(f.tag());
  return f.save();
}

// ---------------------------------------------------------------------------
// Format-specific tag writers — basic + extended + chapters
// ---------------------------------------------------------------------------

static bool tagMP3Chap(const std::string &path) {
  TagLib::MPEG::File f(path.c_str());
  if (!f.isValid()) return false;
  applyAllTagsViaProps(f.ID3v2Tag(true));
  addID3v2Chapters(f.ID3v2Tag(true));
  f.ID3v2Tag(true)->addFrame(makeAPICFrame());
  return f.save(TagLib::MPEG::File::ID3v2, TagLib::File::StripOthers,
                TagLib::ID3v2::v4);
}

static bool tagWAVChap(const std::string &path) {
  TagLib::RIFF::WAV::File f(path.c_str());
  if (!f.isValid()) return false;
  applyAllTagsViaProps(f.ID3v2Tag());
  addID3v2Chapters(f.ID3v2Tag());
  f.ID3v2Tag()->addFrame(makeAPICFrame());
  return f.save();
}

static bool tagAIFFChap(const std::string &path) {
  TagLib::RIFF::AIFF::File f(path.c_str());
  if (!f.isValid() || !f.tag()) return false;
  applyAllTagsViaProps(f.tag());
  addID3v2Chapters(f.tag());
  f.tag()->addFrame(makeAPICFrame());
  return f.save();
}

static bool tagTTAChap(const std::string &path) {
  TagLib::TrueAudio::File f(path.c_str());
  if (!f.isValid()) return false;
  applyAllTagsViaProps(f.ID3v2Tag(true));
  addID3v2Chapters(f.ID3v2Tag(true));
  f.ID3v2Tag(true)->addFrame(makeAPICFrame());
  return f.save();
}

static bool tagDSFChap(const std::string &path) {
  TagLib::DSF::File f(path.c_str());
  if (!f.isValid()) return false;
  applyAllTagsViaProps(f.tag());
  addID3v2Chapters(f.tag());
  f.tag()->addFrame(makeAPICFrame());
  return f.save();
}

static bool tagDSDIFFChap(const std::string &path) {
  TagLib::DSDIFF::File f(path.c_str());
  if (!f.isValid()) return false;
  applyAllTagsViaProps(f.ID3v2Tag(true));
  addID3v2Chapters(f.ID3v2Tag(true));
  f.ID3v2Tag(true)->addFrame(makeAPICFrame());
  return f.save();
}

static bool tagMP4NeroChap(const std::string &path) {
  TagLib::MP4::File f(path.c_str());
  if (!f.isValid() || !f.tag()) return false;
  applyAllTagsViaProps(f.tag());
  addNeroChapters(f);
  TagLib::MP4::CoverArt cover(TagLib::MP4::CoverArt::JPEG, makeFakeJPEG());
  TagLib::MP4::CoverArtList list;
  list.append(cover);
  f.tag()->setItem("covr", list);
  return f.save();
}

static bool tagMP4QtChap(const std::string &path) {
  TagLib::MP4::File f(path.c_str());
  if (!f.isValid() || !f.tag()) return false;
  applyAllTagsViaProps(f.tag());
  addQtChapters(f);
  TagLib::MP4::CoverArt cover(TagLib::MP4::CoverArt::JPEG, makeFakeJPEG());
  TagLib::MP4::CoverArtList list;
  list.append(cover);
  f.tag()->setItem("covr", list);
  return f.save();
}

static bool tagMatroskaChap(const std::string &path) {
  TagLib::Matroska::File f(path.c_str());
  if (!f.isValid()) return false;
  applyAllTagsMatroska(f.tag());
  addMatroskaChapters(f);
  return f.save();
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

int main(int argc, char *argv[]) {
  if (argc < 4) {
    std::cerr << "Usage: tag_with_c_full <input> <output> <format>" << std::endl;
    std::cerr << "  format: mp3|flac|ogg|oggflac|opus|speex|m4a|wav|aiff|mpc|wv|ape|tta|dsf|dff|asf|mkv" << std::endl;
    std::cerr << "    extended: mp3-ext|flac-ext|ogg-ext|oggflac-ext|opus-ext|speex-ext|" << std::endl;
    std::cerr << "              m4a-ext|wav-ext|aiff-ext|mpc-ext|wv-ext|ape-ext|" << std::endl;
    std::cerr << "              tta-ext|dsf-ext|dff-ext|asf-ext|mkv-ext" << std::endl;
    std::cerr << "    chapters: mp3-chap|wav-chap|aiff-chap|tta-chap|dsf-chap|dff-chap|" << std::endl;
    std::cerr << "              m4a-nero|m4a-qt|mkv-chap" << std::endl;
    return 1;
  }

  // Use UTF-8 as the default text encoding for all ID3v2 frames so that all
  // Unicode characters (including CJK) are stored correctly, matching what
  // taglib-ts writes with its UTF-8 default.
  TagLib::ID3v2::FrameFactory::instance()->setDefaultTextEncoding(TagLib::String::UTF8);

  const std::string input  = argv[1];
  const std::string output = argv[2];
  const std::string format = toLower(argv[3]);

  // Copy input to output
  try {
    fs::copy_file(input, output, fs::copy_options::overwrite_existing);
  } catch (const std::exception &e) {
    std::cerr << "Failed to copy '" << input << "' to '" << output << "': "
              << e.what() << std::endl;
    return 1;
  }

  bool ok = false;
  // --- Basic tag variants ---
  if      (format == "mp3")                             ok = tagMP3(output);
  else if (format == "flac")                            ok = tagFLAC(output);
  else if (format == "ogg")                             ok = tagOGGVorbis(output);
  else if (format == "oggflac")                         ok = tagOGGFlac(output);
  else if (format == "opus")                            ok = tagOGGOpus(output);
  else if (format == "speex" || format == "spx")        ok = tagOGGSpeex(output);
  else if (format == "m4a" || format == "mp4" ||
           format == "aac" || format == "alac")         ok = tagMP4(output);
  else if (format == "wav")                             ok = tagWAV(output);
  else if (format == "aiff" || format == "aif")         ok = tagAIFF(output);
  else if (format == "mpc")                             ok = tagMPC(output);
  else if (format == "wv" || format == "wavpack")       ok = tagWavPack(output);
  else if (format == "ape")                             ok = tagAPE(output);
  else if (format == "tta")                             ok = tagTTA(output);
  else if (format == "dsf")                             ok = tagDSF(output);
  else if (format == "dff" || format == "dsdiff")       ok = tagDSDIFF(output);
  else if (format == "asf" || format == "wma")          ok = tagASF(output);
  else if (format == "mkv" || format == "mka" ||
           format == "webm")                            ok = tagMatroska(output);
  // --- Extended tag variants ---
  else if (format == "mp3-ext")                         ok = tagMP3Ext(output);
  else if (format == "flac-ext")                        ok = tagFLACExt(output);
  else if (format == "ogg-ext")                         ok = tagOGGVorbisExt(output);
  else if (format == "oggflac-ext")                     ok = tagOGGFlacExt(output);
  else if (format == "opus-ext")                        ok = tagOGGOpusExt(output);
  else if (format == "speex-ext")                       ok = tagOGGSpeexExt(output);
  else if (format == "m4a-ext")                         ok = tagMP4Ext(output);
  else if (format == "wav-ext")                         ok = tagWAVExt(output);
  else if (format == "aiff-ext")                        ok = tagAIFFExt(output);
  else if (format == "mpc-ext")                         ok = tagMPCExt(output);
  else if (format == "wv-ext")                          ok = tagWavPackExt(output);
  else if (format == "ape-ext")                         ok = tagAPEExt(output);
  else if (format == "tta-ext")                         ok = tagTTAExt(output);
  else if (format == "dsf-ext")                         ok = tagDSFExt(output);
  else if (format == "dff-ext")                         ok = tagDSDIFFExt(output);
  else if (format == "asf-ext")                         ok = tagASFExt(output);
  else if (format == "mkv-ext")                         ok = tagMatroskaExt(output);
  // --- Chapter variants ---
  else if (format == "mp3-chap")                        ok = tagMP3Chap(output);
  else if (format == "wav-chap")                        ok = tagWAVChap(output);
  else if (format == "aiff-chap")                       ok = tagAIFFChap(output);
  else if (format == "tta-chap")                        ok = tagTTAChap(output);
  else if (format == "dsf-chap")                        ok = tagDSFChap(output);
  else if (format == "dff-chap")                        ok = tagDSDIFFChap(output);
  else if (format == "m4a-nero")                        ok = tagMP4NeroChap(output);
  else if (format == "m4a-qt")                          ok = tagMP4QtChap(output);
  else if (format == "mkv-chap")                        ok = tagMatroskaChap(output);
  else {
    std::cerr << "Unknown format: " << format << std::endl;
    return 1;
  }

  if (!ok) {
    std::cerr << "Failed to tag '" << output << "' as format '" << format << "'" << std::endl;
    return 1;
  }

  return 0;
}
