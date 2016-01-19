function replaceAll(find, replace, str) {
  return str.replace(new RegExp(find, 'g'), replace);
}
function encodeEmoticons(str)
{
  str=replaceAll(":\\)",":smile:",str);
  str=replaceAll(":\\(",":sad:",str);
  var index;
  for (index = 0; index < emoticons.length; ++index) {
    str=replaceAll(":"+emoticons[index]+":","<img src=\"emo/"+emoticons[index]+".gif\">",str);
  }
  return str;
}
