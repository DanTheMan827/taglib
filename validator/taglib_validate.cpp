/**
 * taglib_validate.cpp
 *
 * Reads an audio file using C TagLib and outputs JSON with tag info,
 * audio properties, and picture metadata. Used for cross-validation
 * with taglib-ts output.
 *
 * Usage: taglib_validate <filepath>
 * Output: JSON to stdout
 */
#include <cctype>
#include <cstdio>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include <algorithm>

#include <taglib/aifffile.h>
#include <taglib/apefile.h>
#include <taglib/apetag.h>
#include <taglib/asffile.h>
#include <taglib/asfpicture.h>
#include <taglib/asftag.h>
#include <taglib/attachedpictureframe.h>
#include <taglib/audioproperties.h>
#include <taglib/dsdifffile.h>
#include <taglib/dsffile.h>
#include <taglib/fileref.h>
#include <taglib/flacfile.h>
#include <taglib/flacpicture.h>
#include <taglib/id3v2tag.h>
#include <taglib/matroskafile.h>
#include <taglib/mp4file.h>
#include <taglib/mp4tag.h>
#include <taglib/mp4coverart.h>
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

// Escape a UTF-8 string for JSON output
static std::string jsonEscape(const std::string &s) {
  std::ostringstream out;
  for (unsigned char c : s) {
    if (c == '"') out << "\\\"";
    else if (c == '\\') out << "\\\\";
    else if (c == '\n') out << "\\n";
    else if (c == '\r') out << "\\r";
    else if (c == '\t') out << "\\t";
    else if (c < 0x20) {
      char buf[8];
      snprintf(buf, sizeof(buf), "\\u%04x", c);
      out << buf;
    } else {
      out << c;
    }
  }
  return out.str();
}

static std::string toLower(std::string s) {
  std::transform(s.begin(), s.end(), s.begin(), ::tolower);
  return s;
}

static std::string getExt(const std::string &path) {
  auto pos = path.rfind('.');
  if (pos == std::string::npos) return "";
  return toLower(path.substr(pos));
}

struct PictureInfo {
  std::string mimeType;
  std::string description;
  int type = 0;
  int size = 0;
};

static std::string picInfoToJson(const PictureInfo &p) {
  std::ostringstream out;
  out << "{"
      << "\"mimeType\":\"" << jsonEscape(p.mimeType) << "\","
      << "\"description\":\"" << jsonEscape(p.description) << "\","
      << "\"type\":" << p.type << ","
      << "\"size\":" << p.size
      << "}";
  return out.str();
}

static std::vector<PictureInfo> getPictures(const std::string &path, const std::string &ext) {
  std::vector<PictureInfo> pics;

  auto addAPIC = [&](TagLib::ID3v2::Tag *id3) {
    if (!id3) return;
    const auto &fl = id3->frameListMap()["APIC"];
    for (auto *frame : fl) {
      auto *apic = dynamic_cast<TagLib::ID3v2::AttachedPictureFrame *>(frame);
      if (apic) {
        pics.push_back({
          apic->mimeType().toCString(true),
          apic->description().toCString(true),
          static_cast<int>(apic->type()),
          static_cast<int>(apic->picture().size())
        });
      }
    }
  };

  auto addFLACPic = [&](const TagLib::List<TagLib::FLAC::Picture *> &list) {
    for (auto *p : list) {
      pics.push_back({
        p->mimeType().toCString(true),
        p->description().toCString(true),
        static_cast<int>(p->type()),
        static_cast<int>(p->data().size())
      });
    }
  };

  auto addXiphPic = [&](TagLib::Ogg::XiphComment *xiph) {
    if (!xiph) return;
    addFLACPic(xiph->pictureList());
  };

  if (ext == ".flac") {
    TagLib::FLAC::File f(path.c_str());
    if (f.isValid()) addFLACPic(f.pictureList());
  } else if (ext == ".ogg") {
    TagLib::Ogg::Vorbis::File f(path.c_str());
    if (f.isValid()) addXiphPic(f.tag());
  } else if (ext == ".opus") {
    TagLib::Ogg::Opus::File f(path.c_str());
    if (f.isValid()) addXiphPic(f.tag());
  } else if (ext == ".spx") {
    TagLib::Ogg::Speex::File f(path.c_str());
    if (f.isValid()) addXiphPic(f.tag());
  } else if (ext == ".mp3") {
    TagLib::MPEG::File f(path.c_str());
    if (f.isValid()) addAPIC(f.ID3v2Tag());
  } else if (ext == ".m4a" || ext == ".mp4" || ext == ".aac" || ext == ".alac") {
    TagLib::MP4::File f(path.c_str());
    if (f.isValid() && f.tag() && f.tag()->contains("covr")) {
      auto coverList = f.tag()->item("covr").toCoverArtList();
      for (const auto &cover : coverList) {
        std::string mime = "image/unknown";
        if (cover.format() == TagLib::MP4::CoverArt::JPEG) mime = "image/jpeg";
        else if (cover.format() == TagLib::MP4::CoverArt::PNG)  mime = "image/png";
        pics.push_back({ mime, "", 3, static_cast<int>(cover.data().size()) });
      }
    }
  } else if (ext == ".wav") {
    TagLib::RIFF::WAV::File f(path.c_str());
    if (f.isValid()) addAPIC(f.ID3v2Tag());
  } else if (ext == ".aif" || ext == ".aiff") {
    TagLib::RIFF::AIFF::File f(path.c_str());
    if (f.isValid()) addAPIC(f.tag());
  } else if (ext == ".tta") {
    TagLib::TrueAudio::File f(path.c_str());
    if (f.isValid()) addAPIC(f.ID3v2Tag());
  } else if (ext == ".dsf") {
    TagLib::DSF::File f(path.c_str());
    if (f.isValid()) addAPIC(f.tag());
  } else if (ext == ".dff") {
    TagLib::DSDIFF::File f(path.c_str());
    if (f.isValid() && f.hasID3v2Tag()) addAPIC(f.ID3v2Tag());
  } else if (ext == ".oga") {
    TagLib::Ogg::FLAC::File f(path.c_str());
    if (f.isValid()) addXiphPic(f.tag());
  } else if (ext == ".asf" || ext == ".wma") {
    TagLib::ASF::File f(path.c_str());
    if (f.isValid() && f.tag()) {
      for (const auto &attr : f.tag()->attribute("WM/Picture")) {
        const auto &pic = attr.toPicture();
        if (pic.isValid()) {
          pics.push_back({
            pic.mimeType().toCString(true),
            pic.description().toCString(true),
            static_cast<int>(pic.type()),
            static_cast<int>(pic.picture().size())
          });
        }
      }
    }
  }

  return pics;
}

int main(int argc, char *argv[]) {
  if (argc < 2) {
    std::cout << R"({"valid":false})" << std::endl;
    return 1;
  }

  const std::string path = argv[1];
  const std::string ext  = getExt(path);

  TagLib::FileRef f(path.c_str());

  if (f.isNull() || !f.tag()) {
    std::cout << R"({"valid":false})" << std::endl;
    return 0;
  }

  auto *tag = f.tag();
  auto *ap  = f.audioProperties();
  auto pictures = getPictures(path, ext);

  std::ostringstream json;
  json << "{";
  json << "\"valid\":true,";
  json << "\"title\":\""   << jsonEscape(tag->title().toCString(true))   << "\",";
  json << "\"artist\":\""  << jsonEscape(tag->artist().toCString(true))  << "\",";
  json << "\"album\":\""   << jsonEscape(tag->album().toCString(true))   << "\",";
  json << "\"comment\":\"" << jsonEscape(tag->comment().toCString(true)) << "\",";
  json << "\"genre\":\""   << jsonEscape(tag->genre().toCString(true))   << "\",";
  json << "\"year\":"      << tag->year()  << ",";
  json << "\"track\":"     << tag->track();

  if (ap) {
    json << ",\"duration\":"   << ap->lengthInSeconds();
    json << ",\"durationMs\":" << ap->lengthInMilliseconds();
    json << ",\"bitrate\":"    << ap->bitrate();
    json << ",\"sampleRate\":" << ap->sampleRate();
    json << ",\"channels\":"   << ap->channels();
  }

  json << ",\"pictureCount\":" << pictures.size();

  if (!pictures.empty()) {
    json << ",\"pictures\":[";
    for (size_t i = 0; i < pictures.size(); ++i) {
      if (i > 0) json << ",";
      json << picInfoToJson(pictures[i]);
    }
    json << "]";
  }

  json << "}";
  std::cout << json.str() << std::endl;
  return 0;
}
