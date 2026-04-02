/**
 * tag_with_c_full.cpp
 *
 * Tags an audio file using C TagLib with a fixed set of tags and a picture.
 * Used for bidirectional cross-validation with taglib-ts.
 *
 * Usage: tag_with_c_full <input> <output> <format>
 *   format: mp3, flac, ogg, oggflac, opus, speex, m4a, wav, aiff, mpc, wv, ape, tta, dsf, dff, asf, mkv
 *
 * Tags written:
 *   title   = "Cross-Validation Test"
 *   artist  = "Cross-Validation Artist"
 *   album   = "Cross-Validation Album"
 *   comment = "Cross-Validation Comment"
 *   genre   = "Electronic"
 *   year    = 2025
 *   track   = 7
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
#include <taglib/dsdifffile.h>
#include <taglib/dsffile.h>
#include <taglib/fileref.h>
#include <taglib/flacfile.h>
#include <taglib/flacpicture.h>
#include <taglib/id3v2tag.h>
#include <taglib/matroskafile.h>
#include <taglib/mp4coverart.h>
#include <taglib/mp4file.h>
#include <taglib/mp4tag.h>
#include <taglib/mpcfile.h>
#include <taglib/mpegfile.h>
#include <taglib/oggflacfile.h>
#include <taglib/opusfile.h>
#include <taglib/speexfile.h>
#include <taglib/tag.h>
#include <taglib/trueaudiofile.h>
#include <taglib/vorbisfile.h>
#include <taglib/wavfile.h>
#include <taglib/wavpackfile.h>
#include <taglib/xiphcomment.h>

namespace fs = std::filesystem;

static std::string toLower(std::string s) {
  std::transform(s.begin(), s.end(), s.begin(), ::tolower);
  return s;
}

// Fixed tag values for cross-validation
static constexpr const char *TITLE   = "Cross-Validation Test";
static constexpr const char *ARTIST  = "Cross-Validation Artist";
static constexpr const char *ALBUM   = "Cross-Validation Album";
static constexpr const char *COMMENT = "Cross-Validation Comment";
static constexpr const char *GENRE   = "Electronic";
static constexpr unsigned int YEAR   = 2025;
static constexpr unsigned int TRACK  = 7;

// Create a deterministic JPEG-like buffer (starts with FF D8)
static TagLib::ByteVector makeFakeJPEG(int size = 512) {
  TagLib::ByteVector data(size, '\x00');
  if (size >= 2) {
    data[0] = static_cast<char>(0xFF);
    data[1] = static_cast<char>(0xD8);
  }
  // Fill with deterministic pattern
  for (int i = 2; i < size; i++) {
    data[i] = static_cast<char>((i * 37 + 13) & 0xFF);
  }
  return data;
}

static void applyBasicTags(TagLib::Tag *tag) {
  tag->setTitle(TITLE);
  tag->setArtist(ARTIST);
  tag->setAlbum(ALBUM);
  tag->setComment(COMMENT);
  tag->setGenre(GENRE);
  tag->setYear(YEAR);
  tag->setTrack(TRACK);
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
  apic->setMimeType("image/jpeg");
  apic->setType(TagLib::ID3v2::AttachedPictureFrame::FrontCover);
  apic->setDescription("Front Cover");
  apic->setPicture(makeFakeJPEG());
  return apic;
}

// Format-specific tag writers

static bool tagMP3(const std::string &path) {
  TagLib::MPEG::File f(path.c_str());
  if (!f.isValid()) return false;
  applyBasicTags(f.ID3v2Tag(true));
  f.ID3v2Tag(true)->addFrame(makeAPICFrame());
  // Strip any existing ID3v1 or APEv2 to keep output clean
  return f.save(TagLib::MPEG::File::ID3v2, TagLib::File::StripOthers,
                TagLib::ID3v2::v4);
}

static bool tagFLAC(const std::string &path) {
  TagLib::FLAC::File f(path.c_str());
  if (!f.isValid()) return false;
  applyBasicTags(f.tag());
  // Remove existing pictures
  f.removePictures();
  f.addPicture(makeFLACPicture());
  return f.save();
}

static bool tagOGGVorbis(const std::string &path) {
  TagLib::Ogg::Vorbis::File f(path.c_str());
  if (!f.isValid() || !f.tag()) return false;
  applyBasicTags(f.tag());
  // Remove existing pictures
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
  // MPC uses APEv2 tags
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
  TagLib::OggFlac::File f(path.c_str());
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
  // Add picture to ASF
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

int main(int argc, char *argv[]) {
  if (argc < 4) {
    std::cerr << "Usage: tag_with_c_full <input> <output> <format>" << std::endl;
    std::cerr << "  format: mp3|flac|ogg|oggflac|opus|speex|m4a|wav|aiff|mpc|wv|ape|tta|dsf|dff|asf|mkv" << std::endl;
    return 1;
  }

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
  if (format == "mp3")                             ok = tagMP3(output);
  else if (format == "flac")                       ok = tagFLAC(output);
  else if (format == "ogg")                        ok = tagOGGVorbis(output);
  else if (format == "oggflac")                    ok = tagOGGFlac(output);
  else if (format == "opus")                       ok = tagOGGOpus(output);
  else if (format == "speex" || format == "spx")  ok = tagOGGSpeex(output);
  else if (format == "m4a" || format == "mp4" ||
           format == "aac" || format == "alac")   ok = tagMP4(output);
  else if (format == "wav")                        ok = tagWAV(output);
  else if (format == "aiff" || format == "aif")   ok = tagAIFF(output);
  else if (format == "mpc")                        ok = tagMPC(output);
  else if (format == "wv" || format == "wavpack") ok = tagWavPack(output);
  else if (format == "ape")                        ok = tagAPE(output);
  else if (format == "tta")                        ok = tagTTA(output);
  else if (format == "dsf")                        ok = tagDSF(output);
  else if (format == "dff" || format == "dsdiff") ok = tagDSDIFF(output);
  else if (format == "asf" || format == "wma")    ok = tagASF(output);
  else if (format == "mkv" || format == "mka" ||
           format == "webm")                       ok = tagMatroska(output);
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
