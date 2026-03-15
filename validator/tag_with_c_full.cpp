/**
 * tag_with_c_full.cpp
 *
 * Tags an audio file using C TagLib with a fixed set of tags and a picture.
 * Used for bidirectional cross-validation with taglib-ts.
 *
 * Usage: tag_with_c_full <input> <output> <format>
 *   format: mp3, flac, ogg, m4a, wav, aif
 *
 * Tags written:
 *   title   = "C TagLib Title"
 *   artist  = "C TagLib Artist"
 *   album   = "C TagLib Album"
 *   comment = "C TagLib Comment"
 *   genre   = "Rock"
 *   year    = 2025
 *   track   = 42
 *   + one JPEG picture of 128 bytes (for formats that support it)
 */
#include <algorithm>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

#include <taglib/aifffile.h>
#include <taglib/attachedpictureframe.h>
#include <taglib/fileref.h>
#include <taglib/flacfile.h>
#include <taglib/flacpicture.h>
#include <taglib/id3v2tag.h>
#include <taglib/mp4coverart.h>
#include <taglib/mp4file.h>
#include <taglib/mp4tag.h>
#include <taglib/mpegfile.h>
#include <taglib/tag.h>
#include <taglib/vorbisfile.h>
#include <taglib/wavfile.h>
#include <taglib/xiphcomment.h>

namespace fs = std::filesystem;

static std::string toLower(std::string s) {
  std::transform(s.begin(), s.end(), s.begin(), ::tolower);
  return s;
}

// Create a 128-byte buffer that starts with the JPEG SOI marker
static TagLib::ByteVector makeFakeJPEG(int size = 128) {
  TagLib::ByteVector data(size, '\x00');
  if (size >= 2) {
    data[0] = static_cast<char>(0xFF);
    data[1] = static_cast<char>(0xD8);
  }
  return data;
}

static bool setBasicTags(const std::string &path) {
  TagLib::FileRef f(path.c_str());
  if (f.isNull() || !f.tag()) return false;
  auto *tag = f.tag();
  tag->setTitle("C TagLib Title");
  tag->setArtist("C TagLib Artist");
  tag->setAlbum("C TagLib Album");
  tag->setComment("C TagLib Comment");
  tag->setGenre("Rock");
  tag->setYear(2025);
  tag->setTrack(42);
  return f.save();
}

static bool addPicture(const std::string &path, const std::string &format) {
  auto imgData = makeFakeJPEG(128);

  if (format == "flac") {
    TagLib::FLAC::File f(path.c_str());
    if (!f.isValid()) return false;
    auto *pic = new TagLib::FLAC::Picture();
    pic->setType(TagLib::FLAC::Picture::FrontCover);
    pic->setMimeType("image/jpeg");
    pic->setDescription("Front Cover");
    pic->setData(imgData);
    f.addPicture(pic);
    return f.save();
  }

  if (format == "ogg") {
    TagLib::Ogg::Vorbis::File f(path.c_str());
    if (!f.isValid() || !f.tag()) return false;
    auto *pic = new TagLib::FLAC::Picture();
    pic->setType(TagLib::FLAC::Picture::FrontCover);
    pic->setMimeType("image/jpeg");
    pic->setDescription("Front Cover");
    pic->setData(imgData);
    f.tag()->addPicture(pic);
    return f.save();
  }

  if (format == "mp3") {
    TagLib::MPEG::File f(path.c_str());
    if (!f.isValid()) return false;
    auto *apic = new TagLib::ID3v2::AttachedPictureFrame();
    apic->setMimeType("image/jpeg");
    apic->setType(TagLib::ID3v2::AttachedPictureFrame::FrontCover);
    apic->setDescription("Front Cover");
    apic->setPicture(imgData);
    f.ID3v2Tag(true)->addFrame(apic);
    return f.save();
  }

  if (format == "m4a" || format == "mp4" || format == "aac") {
    TagLib::MP4::File f(path.c_str());
    if (!f.isValid() || !f.tag()) return false;
    TagLib::MP4::CoverArt cover(TagLib::MP4::CoverArt::JPEG, imgData);
    TagLib::MP4::CoverArtList list;
    list.append(cover);
    f.tag()->setItem("covr", list);
    return f.save();
  }

  // WAV, AIFF, and other formats: pictures not added (basic tags only)
  return true;
}

int main(int argc, char *argv[]) {
  if (argc < 4) {
    std::cerr << "Usage: tag_with_c_full <input> <output> <format>" << std::endl;
    std::cerr << "  format: mp3 | flac | ogg | m4a | wav | aif" << std::endl;
    return 1;
  }

  const std::string input = argv[1];
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

  // Set basic tags
  if (!setBasicTags(output)) {
    std::cerr << "Failed to set basic tags on '" << output << "'" << std::endl;
    return 1;
  }

  // Add picture for formats that support it
  if (!addPicture(output, format)) {
    std::cerr << "Failed to add picture to '" << output << "'" << std::endl;
    return 1;
  }

  return 0;
}
