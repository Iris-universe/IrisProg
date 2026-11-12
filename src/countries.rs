// Pays : code ISO ou nom anglais/français -> nom français (mêmes libellés que Intl.DisplayNames('fr') de l'ancienne version).
use crate::http::norm;
use std::collections::HashMap;
use std::sync::OnceLock;

const TABLE: &str = "AD|Andorre|Andorra;AE|Émirats arabes unis|United Arab Emirates;AF|Afghanistan|Afghanistan;AG|Antigua-et-Barbuda|Antigua & Barbuda;\
AL|Albanie|Albania;AM|Arménie|Armenia;AO|Angola|Angola;AR|Argentine|Argentina;AT|Autriche|Austria;AU|Australie|Australia;AZ|Azerbaïdjan|Azerbaijan;\
BA|Bosnie-Herzégovine|Bosnia & Herzegovina;BB|Barbade|Barbados;BD|Bangladesh|Bangladesh;BE|Belgique|Belgium;BF|Burkina Faso|Burkina Faso;\
BG|Bulgarie|Bulgaria;BH|Bahreïn|Bahrain;BI|Burundi|Burundi;BJ|Bénin|Benin;BO|Bolivie|Bolivia;BR|Brésil|Brazil;BS|Bahamas|Bahamas;BT|Bhoutan|Bhutan;\
BW|Botswana|Botswana;BY|Biélorussie|Belarus;BZ|Belize|Belize;CA|Canada|Canada;CD|Congo-Kinshasa|Congo - Kinshasa;CF|République centrafricaine|Central African Republic;\
CG|Congo-Brazzaville|Congo - Brazzaville;CH|Suisse|Switzerland;CI|Côte d’Ivoire|Côte d’Ivoire;CL|Chili|Chile;CM|Cameroun|Cameroon;CN|Chine|China;\
CO|Colombie|Colombia;CR|Costa Rica|Costa Rica;CU|Cuba|Cuba;CV|Cap-Vert|Cape Verde;CY|Chypre|Cyprus;CZ|Tchéquie|Czechia;DE|Allemagne|Germany;\
DJ|Djibouti|Djibouti;DK|Danemark|Denmark;DM|Dominique|Dominica;DO|République dominicaine|Dominican Republic;DZ|Algérie|Algeria;EC|Équateur|Ecuador;\
EE|Estonie|Estonia;EG|Égypte|Egypt;ER|Érythrée|Eritrea;ES|Espagne|Spain;ET|Éthiopie|Ethiopia;FI|Finlande|Finland;FJ|Fidji|Fiji;FR|France|France;\
GA|Gabon|Gabon;GB|Royaume-Uni|United Kingdom;GD|Grenade|Grenada;GE|Géorgie|Georgia;GH|Ghana|Ghana;GM|Gambie|Gambia;GN|Guinée|Guinea;\
GQ|Guinée équatoriale|Equatorial Guinea;GR|Grèce|Greece;GT|Guatemala|Guatemala;GW|Guinée-Bissau|Guinea-Bissau;GY|Guyana|Guyana;\
HK|R.A.S. chinoise de Hong Kong|Hong Kong SAR China;HN|Honduras|Honduras;HR|Croatie|Croatia;HT|Haïti|Haiti;HU|Hongrie|Hungary;ID|Indonésie|Indonesia;\
IE|Irlande|Ireland;IL|Israël|Israel;IN|Inde|India;IQ|Irak|Iraq;IR|Iran|Iran;IS|Islande|Iceland;IT|Italie|Italy;JM|Jamaïque|Jamaica;JO|Jordanie|Jordan;\
JP|Japon|Japan;KE|Kenya|Kenya;KG|Kirghizistan|Kyrgyzstan;KH|Cambodge|Cambodia;KR|Corée du Sud|South Korea;KW|Koweït|Kuwait;KZ|Kazakhstan|Kazakhstan;\
LA|Laos|Laos;LB|Liban|Lebanon;LI|Liechtenstein|Liechtenstein;LK|Sri Lanka|Sri Lanka;LR|Libéria|Liberia;LS|Lesotho|Lesotho;LT|Lituanie|Lithuania;\
LU|Luxembourg|Luxembourg;LV|Lettonie|Latvia;LY|Libye|Libya;MA|Maroc|Morocco;MC|Monaco|Monaco;MD|Moldavie|Moldova;ME|Monténégro|Montenegro;\
MG|Madagascar|Madagascar;MK|Macédoine du Nord|North Macedonia;ML|Mali|Mali;MM|Myanmar (Birmanie)|Myanmar (Burma);MN|Mongolie|Mongolia;\
MR|Mauritanie|Mauritania;MT|Malte|Malta;MU|Maurice|Mauritius;MV|Maldives|Maldives;MW|Malawi|Malawi;MX|Mexique|Mexico;MY|Malaisie|Malaysia;\
MZ|Mozambique|Mozambique;NA|Namibie|Namibia;NE|Niger|Niger;NG|Nigeria|Nigeria;NI|Nicaragua|Nicaragua;NL|Pays-Bas|Netherlands;NO|Norvège|Norway;\
NP|Népal|Nepal;NZ|Nouvelle-Zélande|New Zealand;OM|Oman|Oman;PA|Panama|Panama;PE|Pérou|Peru;PG|Papouasie-Nouvelle-Guinée|Papua New Guinea;\
PH|Philippines|Philippines;PK|Pakistan|Pakistan;PL|Pologne|Poland;PR|Porto Rico|Puerto Rico;PS|Territoires palestiniens|Palestinian Territories;\
PT|Portugal|Portugal;PY|Paraguay|Paraguay;QA|Qatar|Qatar;RE|La Réunion|Réunion;RO|Roumanie|Romania;RS|Serbie|Serbia;RU|Russie|Russia;RW|Rwanda|Rwanda;\
SA|Arabie saoudite|Saudi Arabia;SC|Seychelles|Seychelles;SD|Soudan|Sudan;SE|Suède|Sweden;SG|Singapour|Singapore;SI|Slovénie|Slovenia;SK|Slovaquie|Slovakia;\
SL|Sierra Leone|Sierra Leone;SM|Saint-Marin|San Marino;SN|Sénégal|Senegal;SO|Somalie|Somalia;SR|Suriname|Suriname;SV|Salvador|El Salvador;SY|Syrie|Syria;\
TD|Tchad|Chad;TG|Togo|Togo;TH|Thaïlande|Thailand;TJ|Tadjikistan|Tajikistan;TN|Tunisie|Tunisia;TR|Turquie|Türkiye;TT|Trinité-et-Tobago|Trinidad & Tobago;\
TW|Taïwan|Taiwan;TZ|Tanzanie|Tanzania;UA|Ukraine|Ukraine;UG|Ouganda|Uganda;US|États-Unis|United States;UY|Uruguay|Uruguay;UZ|Ouzbékistan|Uzbekistan;\
VE|Venezuela|Venezuela;VN|Viêt Nam|Vietnam;YE|Yémen|Yemen;ZA|Afrique du Sud|South Africa;ZM|Zambie|Zambia;ZW|Zimbabwe|Zimbabwe";

const ALIASES: &[(&str, &str)] = &[
    ("USA", "US"), ("United States of America", "US"), ("UK", "GB"), ("England", "GB"), ("Scotland", "GB"), ("Wales", "GB"),
    ("Great Britain", "GB"), ("Russian Federation", "RU"), ("Czech Republic", "CZ"), ("Turkey", "TR"), ("Hong Kong", "HK"),
    ("Ivory Coast", "CI"), ("Viet Nam", "VN"), ("Bosnia and Herzegovina", "BA"), ("Trinidad and Tobago", "TT"), ("Korea", "KR"),
    ("Republic of Korea", "KR"), ("Macedonia", "MK"), ("Palestine", "PS"), ("Belgie", "BE"), ("Deutschland", "DE"), ("Schweiz", "CH"),
];

struct T {
    fr: HashMap<&'static str, &'static str>,
    by_name: HashMap<String, &'static str>,
}

fn t() -> &'static T {
    static X: OnceLock<T> = OnceLock::new();
    X.get_or_init(|| {
        let mut fr = HashMap::new();
        let mut by_name = HashMap::new();
        for row in TABLE.split(';') {
            let mut p = row.split('|');
            let (Some(c), Some(f), Some(e)) = (p.next(), p.next(), p.next()) else { continue };
            fr.insert(c, f);
            by_name.insert(norm(e), c);
            by_name.insert(norm(f), c);
        }
        for (a, c) in ALIASES {
            by_name.insert(norm(a), *c);
        }
        T { fr, by_name }
    })
}

/// "CH", "Switzerland", "Suisse" -> "Suisse" ; inconnu -> "".
pub fn fr(x: &str) -> String {
    let v = x.trim();
    if v.is_empty() {
        return String::new();
    }
    let t = t();
    if v.len() == 2 && v.chars().all(|c| c.is_ascii_uppercase()) {
        return t.fr.get(v).map(|s| s.to_string()).unwrap_or_default();
    }
    let n = norm(v);
    let n = n.strip_prefix("the").filter(|_| v.to_lowercase().starts_with("the ")).unwrap_or(&n);
    t.by_name.get(n).and_then(|c| t.fr.get(c)).map(|s| s.to_string()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    #[test]
    fn countries() {
        assert_eq!(super::fr("CH"), "Suisse");
        assert_eq!(super::fr("United Kingdom"), "Royaume-Uni");
        assert_eq!(super::fr("The Netherlands"), "Pays-Bas");
        assert_eq!(super::fr("USA"), "États-Unis");
        assert_eq!(super::fr("Allemagne"), "Allemagne");
        assert_eq!(super::fr("Atlantis"), "");
    }
}
