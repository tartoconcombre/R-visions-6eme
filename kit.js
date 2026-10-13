/* =============================================================
   KIT COMMUN « Mes révisions » — moteur d'exercices adaptatif
   -------------------------------------------------------------
   Chaque exercice charge kit.css et kit.js, puis appelle :

     Revision.lancer({
       matiere: "Maths",               // même nom que dans index.html
       titre:   "L'écriture des nombres",
       lecon:   "<h3>…</h3><p>…</p>",  // facultatif
       notions: [ … ]                   // voir le modèle
     });

   Chaque notion monte trois marches :
     1. Je reconnais  → QCM
     2. Je complète   → saisie avec un coup de pouce
     3. J'écris seul  → saisie libre
   Réussi → la notion monte d'une marche (après la 3e : « Acquis »).
   Raté   → elle redescend d'une marche et revient un peu plus tard.
   La progression est gardée sur l'appareil, d'une fois sur l'autre.
   ============================================================= */
(function(){
"use strict";

/* Couleurs de secours si index.html n'est pas joignable (ouverture hors ligne). */
var COULEURS_SECOURS = {
  "maths":"#dc2626", "francais":"#7c3aed", "histoire":"#64748b", "geographie":"#94a3b8",
  "emc":"#14532d", "physique":"#16a34a", "chimie":"#16a34a", "svt":"#ffffff",
  "anglais":"#2563eb", "allemand":"#ea580c", "musique":"#fde047"
};
var ARTICLES = ["l'","le ","la ","les ","un ","une ","des ","du ","de la ","de l'","d'",
                "the ","a ","an ","der ","die ","das ","ein ","eine "];
var ETAPES = ["", "Je reconnais", "Je complète", "J'écris seul"];

var R = window.Revision = {};
var cfg, fichier, notions, maitrise, recents = [], erreursSuite = 0;
var serie = null;   // la série en cours
var $ = function(id){ return document.getElementById(id); };

/* ------------------------- Outils ------------------------- */
function melange(a){ a=a.slice(); for(var i=a.length-1;i>0;i--){ var j=Math.floor(Math.random()*(i+1)); var t=a[i]; a[i]=a[j]; a[j]=t; } return a; }
function unDe(a){ return a[Math.floor(Math.random()*a.length)]; }
function echappe(s){ return String(s).replace(/[&<>"]/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
function sansAccents(s){ return s.normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/ß/g,"ss").replace(/œ/g,"oe").replace(/æ/g,"ae"); }
function hache(s){ var h=0; for(var i=0;i<s.length;i++){ h=(h*31+s.charCodeAt(i))|0; } return "n"+(h>>>0).toString(36); }
function texteSeul(html){ var d=document.createElement("div"); d.innerHTML=html; return d.textContent||""; }
function lire(cle){ try{ return JSON.parse(localStorage.getItem(cle)); }catch(e){ return null; } }
function ecrire(cle,v){ try{ localStorage.setItem(cle, JSON.stringify(v)); }catch(e){} }

/* ------------------------- Couleur de la matière ------------------------- */
function rvb(hex){ var c=hex.replace("#",""); if(c.length===3) c=c.replace(/./g,"$&$&"); return [0,2,4].map(function(i){ return parseInt(c.substr(i,2),16); }); }
function versHex(t){ return "#"+t.map(function(v){ return ("0"+Math.round(v).toString(16)).slice(-2); }).join(""); }
function lum(t){ var a=t.map(function(v){ v/=255; return v<=.03928? v/12.92 : Math.pow((v+.055)/1.055,2.4); }); return .2126*a[0]+.7152*a[1]+.0722*a[2]; }
function contraste(a,b){ var x=lum(a), y=lum(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); }
function appliquerCouleur(hex){
  var c=rvb(hex), blanc=[255,255,255], encre=[31,42,68];
  var surCouleur = contraste(c,blanc) >= contraste(c,encre) ? "#ffffff" : "#1f2a44";
  var fort=c.slice(), k=0;   /* fonce la couleur jusqu'à être lisible sur le papier */
  while(contraste(fort,blanc) < 4.5 && k<20){ fort=fort.map(function(v,i){ return v*.86 + encre[i]*.14; }); k++; }
  var s=document.documentElement.style;
  s.setProperty("--matiere", hex);
  s.setProperty("--matiere-encre", surCouleur);
  s.setProperty("--matiere-fort", versHex(fort));
  s.setProperty("--matiere-voile", versHex(fort)+"1a");
  var m=document.querySelector('meta[name="theme-color"]');
  if(!m){ m=document.createElement("meta"); m.name="theme-color"; document.head.appendChild(m); }
  m.content=hex;
}
function cleMatiere(nom){ return sansAccents(String(nom).toLowerCase()).replace(/[^a-z]/g,""); }
function chargerCouleur(){
  if(cfg.couleur){ appliquerCouleur(cfg.couleur); return; }
  var cle=cleMatiere(cfg.matiere);
  appliquerCouleur(lire("couleur:"+cle) || COULEURS_SECOURS[cle] || "#2563eb");
  /* La vraie source : la liste MATIERES de la page d'accueil. */
  if(!window.fetch || location.protocol==="file:") return;
  fetch(cfg.accueil || "index.html", {cache:"no-cache"}).then(function(r){ return r.ok ? r.text() : ""; }).then(function(t){
    var re=/nom\s*:\s*["']([^"']+)["']\s*,\s*couleur\s*:\s*["'](#[0-9a-fA-F]{3,6})["']/g, m;
    while((m=re.exec(t))){
      if(cleMatiere(m[1])===cle){ appliquerCouleur(m[2]); ecrire("couleur:"+cle, m[2]); return; }
    }
  }).catch(function(){});
}

/* ------------------------- Comparaison des réponses ------------------------- */
function normalise(s, strict){
  s=String(s).toLowerCase().trim().replace(/[’`]/g,"'").replace(/\s+/g," ");
  s=s.replace(/(\d)\s+(?=\d)/g,"$1").replace(/(\d)\.(\d)/g,"$1,$2");
  s=s.replace(/[-–]/g," ").replace(/[!?;:«»"()]/g,"").replace(/\.$/,"").replace(/\s+/g," ").trim();
  if(!strict){
    for(var i=0;i<ARTICLES.length;i++){ if(s.indexOf(ARTICLES[i])===0 && s.length>ARTICLES[i].length){ s=s.slice(ARTICLES[i].length); break; } }
  }
  return s.trim();
}
function sansPluriel(s){ return s.split(" ").map(function(m){ return m.length>3 ? m.replace(/(s|x)$/,"") : m; }).join(" "); }
function ecart(a,b){
  if(Math.abs(a.length-b.length)>1) return 2;
  var p=[], i, j; for(j=0;j<=b.length;j++) p[j]=j;
  for(i=1;i<=a.length;i++){ var c=[i]; for(j=1;j<=b.length;j++){ c[j]=Math.min(p[j]+1, c[j-1]+1, p[j-1]+(a[i-1]===b[j-1]?0:1)); } p=c; }
  return p[b.length];
}
/* Renvoie {verdict:"juste"|"presque"|"faux", note:"…"} */
function comparer(saisie, item){
  var strict=!!item.strict, ok=item.r, i;
  var s=normalise(saisie,strict), s0=sansAccents(s);
  if(!s) return {verdict:"faux"};
  for(i=0;i<ok.length;i++){ if(s===normalise(ok[i],strict)) return {verdict:"juste"}; }
  for(i=0;i<ok.length;i++){
    if(s0===sansAccents(normalise(ok[i],strict))){
      return cfg.accents==="exiges"
        ? {verdict:"presque", note:"Attention aux accents : on écrit « "+ok[0]+" »."}
        : {verdict:"juste", note:"Pense aux accents : « "+ok[0]+" »."};
    }
  }
  if(!strict){
    for(i=0;i<ok.length;i++){ if(sansPluriel(s0)===sansPluriel(sansAccents(normalise(ok[i],false)))) return {verdict:"juste"}; }
    for(i=0;i<ok.length;i++){
      var o=sansAccents(normalise(ok[i],false));
      if(o.length>=5 && !/^\d+$/.test(o) && ecart(s0,o)===1) return {verdict:"presque", note:"Il manque juste une lettre ou une lettre est en trop : « "+ok[0]+" »."};
    }
  }
  return {verdict:"faux"};
}
R.comparer = function(saisie, r, opts){ return comparer(saisie, {r:[].concat(r), strict:opts&&opts.strict}); };

/* ------------------------- Notions et progression ------------------------- */
function preparerNotions(){
  notions = cfg.notions.map(function(n, k){
    var copie={}; for(var p in n) copie[p]=n[p];
    copie.id = n.id || hache((n.theme||"")+"|"+(n.q||n.nom||k));
    return copie;
  });
  maitrise = lire("maitrise:"+fichier) || {};
}
function etat(n){ return maitrise[n.id] || (maitrise[n.id] = {n:0, acq:false, vu:0}); }
function sauver(){ ecrire("maitrise:"+fichier, maitrise); }
function nomNotion(n){ return n.nom || n.theme || texteSeul(n.q||"").slice(0,50); }

/* Fabrique une question concrète à partir d'une notion (fixe ou générée).
   gen reçoit l'étape (1, 2 ou 3) : une notion peut donc changer de question selon l'étape. */
function instance(n, niv){
  var it={}, p, g = n.gen ? n.gen(niv) : {};
  for(p in n) if(p!=="gen") it[p]=n[p];
  for(p in g) it[p]=g[p];
  it.r = [].concat(it.r).map(String);
  it.autres = (it.autres||[]).map(String);
  return it;
}
function niveauPour(n, voulu){
  if(n.qcmSeul) return 1;
  if(n.sansQcm) return Math.max(2, voulu);
  return voulu;
}
function demarrage(){
  /* Tout réussit depuis 5 réponses ? Une nouvelle notion démarre directement à l'étape 2. */
  var r=recents.slice(-5);
  return (r.length===5 && r.filter(Boolean).length>=4) ? 2 : 1;
}

/* Choisit la prochaine notion de l'entraînement. */
function prochaine(){
  var file=serie.file, i;
  for(i=0;i<file.length;i++){ file[i].dans--; }
  for(i=0;i<file.length;i++){ if(file[i].dans<=0){ return {n:file.splice(i,1)[0].n, rappel:true}; } }
  var liste = serie.liste;   /* toutes les notions, ou celles de la partie choisie */
  var enCours = liste.filter(function(n){ var e=etat(n); return !e.acq && e.vu>0; });
  var neuves  = liste.filter(function(n){ return etat(n).vu===0; });
  var acquises= liste.filter(function(n){ return etat(n).acq; });
  /* Au plus 4 notions travaillées en même temps, pour ne pas surcharger. */
  var groupe = enCours.slice();
  while(groupe.length<4 && neuves.length){ groupe.push(neuves.shift()); }
  var candidats = groupe.filter(function(n){ return n!==serie.derniere; });
  if(acquises.length && (Math.random()<1/6 || !groupe.length)){
    var a=acquises.filter(function(n){ return n!==serie.derniere; });
    if(a.length) return {n:unDe(a), revision:true};
  }
  if(!candidats.length) candidats = groupe.length ? groupe : liste;
  /* Priorité aux notions les moins avancées. */
  candidats.sort(function(x,y){ return etat(x).n-etat(y).n || etat(x).vu-etat(y).vu; });
  var bas = candidats.filter(function(n){ return etat(n).n===etat(candidats[0]).n; });
  return {n:unDe(bas)};
}

/* ------------------------- Écrans ------------------------- */
function squelette(){
  document.body.innerHTML =
    '<header class="couverture"><div class="barre-haut">'+
      '<a href="'+echappe(cfg.accueil||"index.html")+'">‹ Mes révisions</a>'+
      '<button class="lien cache" id="k-retour">Sommaire</button></div>'+
      '<div class="etiquette"><p class="matiere-nom">'+echappe(cfg.matiere)+'</p><h1>'+echappe(cfg.titre)+'</h1></div>'+
    '</header><main id="k-page"></main>';
  $("k-retour").onclick = accueil;
  if(!document.title) document.title = cfg.titre;
}
function page(html, retour){
  $("k-page").innerHTML = html;
  $("k-retour").classList.toggle("cache", !retour);
  window.scrollTo(0,0);
}
function marches(niv, acq){
  var h='<span class="marches" aria-hidden="true">';
  for(var i=1;i<=3;i++) h+='<i class="'+((acq||i<=niv)?"fait":"")+'"></i>';
  return h+'</span>';
}
function niveauAtteint(e){ return e.acq ? 3 : Math.max(0, e.n-1); }

/* ------------------------- Bilan : suis-je prêt ? -------------------------
   « pret »    : tout est acquis et dernier contrôle ≥ 80 %
   « tester »  : tout est acquis à l'entraînement, il reste à se tester
   « travail » : des notions sont encore en cours (on les nomme)
   « debut »   : rien n'est commencé                                          */
function bilan(){
  var dc=lire("dernier-controle:"+fichier), seuil=cfg.seuil||0.8;
  var aRevoir=notions.filter(function(n){ var e=etat(n); return !e.acq; });
  var commencees=notions.filter(function(n){ return etat(n).vu>0; });
  aRevoir.sort(function(a,b){ var x=etat(a), y=etat(b);
    return (x.vu>0?0:1)-(y.vu>0?0:1) || niveauAtteint(x)-niveauAtteint(y); });
  var noms=function(l){ return l.slice(0,3).map(function(n){ return "<b>"+echappe(nomNotion(n))+"</b>"; }).join(", ")
                        +(l.length>3?" et "+(l.length-3)+" autre"+(l.length>4?"s":""):""); };
  if(!commencees.length) return {niveau:"debut", titre:"Par où commencer ?",
    texte:"Relis la leçon, puis entraîne-toi : les questions s'adaptent à ce que tu sais déjà."};
  if(aRevoir.length){
    return {niveau:"travail", titre:"Pas encore tout à fait prêt",
      texte:"Encore à réviser : "+noms(aRevoir)+". Continue à t'entraîner, puis reviens te tester quand tu te sens prêt."};
  }
  if(!dc || dc.bon/dc.total < seuil){
    return {niveau:"tester", titre:"Tu as l'air prêt : vérifie-le !",
      texte:(dc ? "Au dernier contrôle, tu as eu "+dc.bon+" / "+dc.total+". Depuis, tu as tout retravaillé. " : "Toutes les notions sont acquises à l'entraînement. ")+
            "Fais le contrôle quand tu te sens prêt, sans regarder la leçon."};
  }
  return {niveau:"pret", titre:"Tu es prêt pour l'évaluation",
    texte:"Toutes les notions sont acquises et tu as eu "+dc.bon+" / "+dc.total+" au dernier contrôle. Juste avant l'évaluation, un dernier entraînement suffira."};
}
function carteBilan(){
  var b=bilan();
  return '<div class="bilan '+b.niveau+'"><p class="bilan-titre">'+b.titre+'</p><p>'+b.texte+'</p></div>';
}

function deLaPartie(p){ return notions.filter(function(n){ return n.theme===p.theme; }); }
function compteAcquises(l){ return l.filter(function(n){ return etat(n).acq; }).length; }
/* Parcours en points numérotés : 1. leçon, puis une partie par thème, puis le bilan. */
function accueilParcours(){
  serie=null;
  var P=cfg.parties, rec=lire("meilleur:"+fichier), h='', k=1, suivante=-1;
  P.forEach(function(p,i){ var l=deLaPartie(p); if(suivante<0 && compteAcquises(l)<l.length) suivante=i; });
  if(cfg.intro) h+='<p>'+cfg.intro+'</p>';
  if(cfg.lecon){
    h+='<h2>'+(k++)+'. La leçon</h2><button class="btn" id="k-lecon">Lire la leçon<small>L\'essentiel à savoir, avec le son</small></button>';
  }
  P.forEach(function(p,i){
    var l=deLaPartie(p), a=compteAcquises(l);
    h+='<h2>'+(k++)+'. '+echappe(p.titre)+'</h2><button class="btn'+(i===suivante?' plein':'')+'" id="k-p'+i+'">'+
       (a===l.length ? 'Réviser' : a ? 'Continuer' : 'Commencer')+
       '<small>'+(p.sous ? echappe(p.sous)+' · ' : '')+(a===l.length ? 'tout est acquis' : a+' acquis sur '+l.length)+'</small></button>';
  });
  var b=bilan();
  h+='<h2>'+(k++)+'. Bilan</h2>'+carteBilan();
  h+='<button class="btn'+(suivante<0?' plein':'')+'" id="k-ctrl">Faire le contrôle<small>'+
     (rec ? "Meilleur score : "+rec.bon+" / "+rec.total : (cfg.controle||10)+" questions sur tout, sans aide")+'</small></button>';
  h+='<h2>Mon carnet de progrès</h2>';
  P.forEach(function(p){
    h+='<h3>'+echappe(p.titre)+'</h3><ul class="carnet">';
    deLaPartie(p).forEach(function(n){ var e=etat(n);
      h+='<li><span class="nom">'+echappe(nomNotion(n))+'</span>'+(e.acq ? '<span class="tampon">Acquis</span>' : marches(niveauAtteint(e)))+'</li>'; });
    h+='</ul>';
  });
  h+='<p class="legende">Chaque notion monte trois marches : je reconnais, je complète, j\'écris seul.</p>';
  h+='<button class="btn centre" id="k-zero" style="font-weight:400">Recommencer la progression à zéro</button>';
  page(h,false);
  if(cfg.lecon) $("k-lecon").onclick=lecon;
  P.forEach(function(p,i){ $("k-p"+i).onclick=function(){ demarrer("entrainement", p); }; });
  $("k-ctrl").onclick=function(){ demarrer("controle"); };
  $("k-zero").onclick=function(){
    if(confirm("Effacer la progression de cet exercice ? (le meilleur score au contrôle est gardé)")){ maitrise={}; sauver(); accueil(); }
  };
}

function accueil(){
  if(cfg.parties) return accueilParcours();
  serie=null;
  var acquises=notions.filter(function(n){ return etat(n).acq; }).length;
  var rec=lire("meilleur:"+fichier);
  var h='';
  if(cfg.intro) h+='<p>'+cfg.intro+'</p>';
  var b=bilan(); h+=carteBilan();
  var ctrlPlein = b.niveau==="tester"||b.niveau==="pret";
  if(cfg.lecon) h+='<button class="btn" id="k-lecon">Relire la leçon<small>L\'essentiel à savoir</small></button>';
  h+='<button class="btn'+(ctrlPlein?'':' plein')+'" id="k-entr">S\'entraîner<small>'+
     (acquises===notions.length ? "Tout est acquis : place aux révisions" : acquises+" notion"+(acquises>1?"s":"")+" acquise"+(acquises>1?"s":"")+" sur "+notions.length)+'</small></button>';
  h+='<button class="btn'+(ctrlPlein?' plein':'')+'" id="k-ctrl">Faire le contrôle<small>'+
     (rec ? "Meilleur score : "+rec.bon+" / "+rec.total : (cfg.controle||10)+" questions, sans aide")+'</small></button>';
  h+='<h2>Mon carnet de progrès</h2><ul class="carnet">';
  notions.forEach(function(n){
    var e=etat(n);
    h+='<li><span class="nom">'+echappe(nomNotion(n))+'</span>'+
       (e.acq ? '<span class="tampon">Acquis</span>' : marches(niveauAtteint(e)))+'</li>';
  });
  h+='</ul><p class="legende">Chaque notion monte trois marches : je reconnais, je complète, j\'écris seul.</p>';
  h+='<button class="btn centre" id="k-zero" style="font-weight:400">Recommencer la progression à zéro</button>';
  page(h,false);
  if(cfg.lecon) $("k-lecon").onclick=lecon;
  $("k-entr").onclick=function(){ demarrer("entrainement"); };
  $("k-ctrl").onclick=function(){ demarrer("controle"); };
  $("k-zero").onclick=function(){
    if(confirm("Effacer la progression de cet exercice ? (le meilleur score au contrôle est gardé)")){ maitrise={}; sauver(); accueil(); }
  };
}

function lecon(){
  page('<div class="lecon">'+cfg.lecon+'</div><button class="btn plein centre" id="k-go">'+(cfg.parties ? 'Passer au point 2 : '+echappe(cfg.parties[0].titre) : 'S\'entraîner')+'</button>', true);
  $("k-go").onclick=function(){ demarrer("entrainement", cfg.parties ? cfg.parties[0] : null); };
}

function demarrer(mode, partie){
  serie={mode:mode, total: mode==="controle" ? (cfg.controle||10) : (cfg.serie||12),
         i:0, bon:0, erreurs:[], file:[], derniere:null, tirage:null,
         partie:partie||null, liste: partie ? deLaPartie(partie) : notions};
  if(mode==="controle"){
    var t=[]; while(t.length<serie.total){ t=t.concat(melange(notions)); }
    serie.tirage=t.slice(0,serie.total);
  }
  question();
}

function question(){
  if(serie.i>=serie.total) return fin();
  var choix, n, niv, e;
  if(serie.mode==="controle"){ n=serie.tirage[serie.i]; niv=niveauPour(n,3); choix={}; }
  else{
    choix=prochaine(); n=choix.n; e=etat(n);
    if(e.vu===0 && !e.n) e.n=demarrage();
    niv = niveauPour(n, choix.revision ? 3 : Math.min(3,Math.max(1,e.n)));
  }
  serie.derniere=n;
  var it=instance(n, niv);
  serie.courant={n:n, it:it, niv:niv, revision:choix.revision, rappel:choix.rappel};

  var pct=Math.round(serie.i/serie.total*100);
  var h='<div class="entete-q"><div class="jauge"><span style="width:'+pct+'%"></span></div>'+
        '<span class="compteur">'+(serie.i+1)+' / '+serie.total+'</span></div>';
  if(serie.mode==="controle") h+='<p class="etape"><b>Contrôle</b> <span class="doux">sans aide</span></p>';
  else h+='<p class="etape">'+marches(niv)+'<span><b>Étape '+niv+' : '+ETAPES[niv]+'</b>'+
          (choix.rappel?' <span class="doux">· on y revient</span>':choix.revision?' <span class="doux">· révision</span>':'')+'</span></p>';
  h+='<div class="carte-q"><p class="theme">'+echappe(it.theme||"")+'</p><p class="enonce">'+it.q+
     (it.grand?'<span class="grand">'+echappe(it.grand)+'</span>':'')+'</p>'+(it.image||"")+'</div>';

  var modeQcm = niv===1 || (niv===2 && !it.aide && !masquable(it.r[0]));
  if(modeQcm){
    var options = optionsQcm(it, niv===1 ? 4 : 6);
    h+='<div class="choix" id="k-choix">';
    options.forEach(function(o,k){ h+='<button class="btn" data-k="'+k+'">'+echappe(o)+'</button>'; });
    h+='</div>';
    serie.courant.options=options;
  } else {
    h+='<form class="saisie" id="k-form" autocomplete="off"><input id="k-in" type="text" '+
       (it.chiffres?'inputmode="numeric" ':'')+'autocapitalize="off" spellcheck="false" aria-label="Ta réponse">'+
       '<button class="btn plein" type="submit">Valider</button></form>';
    var clavier = it.clavier || cfg.clavier;
    if(clavier) h+='<div class="touches">'+clavier.map(function(c){ return '<button type="button" data-c="'+echappe(c)+'">'+echappe(c)+'</button>'; }).join("")+'</div>';
    if(niv===2){
      h+='<div class="aide">'+(it.aide?'<div>'+it.aide+'</div>':'')+
         (masquable(it.r[0])?'<div>'+(it.aide?'':'Coup de pouce : ')+'<span class="masque">'+masque(it.r[0])+'</span></div>':'')+'</div>';
    }
  }
  h+='<div id="k-retour-q"></div>';
  page(h,true);

  if(modeQcm){
    [].forEach.call(document.querySelectorAll("#k-choix .btn"), function(b){
      b.onclick=function(){ repondreQcm(+b.getAttribute("data-k")); };
    });
  } else {
    var inp=$("k-in");
    $("k-form").onsubmit=function(ev){ ev.preventDefault(); if(inp.value.trim()) repondreSaisie(inp.value); };
    [].forEach.call(document.querySelectorAll(".touches button"), function(b){
      b.onclick=function(){ inp.value+=b.getAttribute("data-c"); inp.focus(); };
    });
    setTimeout(function(){ try{ inp.focus({preventScroll:true}); }catch(e){} }, 50);
  }
}

function masquable(r){ var t=String(r); return t.length>=3 && !/^[\d\s,.]+$/.test(t); }
function masque(r){
  /* Première lettre de chaque mot visible, le reste en tirets : « t _ _ _ _ - c _ _ _ » */
  /* Chaque morceau reste entier ; la ligne peut se couper après un trait d'union ou une espace. */
  return String(r).split(/(\s+|-|')/).map(function(m){
    if(!m) return "";
    if(/^\s+$/.test(m)) return " &nbsp; ";
    if(m==="-"||m==="'") return m+"<wbr>";
    return '<span style="white-space:nowrap">'+echappe(m[0])+m.slice(1).replace(/./g,"_ ")+'</span>';
  }).join("");
}
function optionsQcm(it, combien){
  var bonne=it.r[0], vus={}, out=[bonne];
  vus[normalise(bonne,true)]=1;
  var pool = it.autres.slice();
  /* Compléter avec les réponses d'autres notions du même thème. */
  notions.forEach(function(n){ if(!n.gen && n.theme===it.theme && n.r!==undefined) pool=pool.concat([].concat(n.r)[0]); });
  pool = it.autres.concat(melange(pool.slice(it.autres.length)));
  for(var i=0;i<pool.length && out.length<combien;i++){
    var k=normalise(pool[i],true);
    if(!vus[k] && it.r.every(function(x){ return normalise(x,true)!==k; })){ vus[k]=1; out.push(pool[i]); }
  }
  return melange(out);
}

function repondreQcm(k){
  var c=serie.courant, juste = c.it.r.some(function(x){ return normalise(x,true)===normalise(c.options[k],true); });
  [].forEach.call(document.querySelectorAll("#k-choix .btn"), function(b,j){
    b.disabled=true;
    var ok=c.it.r.some(function(x){ return normalise(x,true)===normalise(c.options[j],true); });
    if(ok) b.classList.add("juste"); else if(j===k) b.classList.add("faux");
  });
  conclure(juste ? {verdict:"juste"} : {verdict:"faux"}, c.options[k]);
}
function repondreSaisie(v){
  var c=serie.courant;
  $("k-in").disabled=true; document.querySelector("#k-form .btn").disabled=true;
  [].forEach.call(document.querySelectorAll(".touches button"), function(b){ b.disabled=true; });
  conclure(comparer(v,c.it), v);
}

function conclure(res, donne){
  var c=serie.courant, it=c.it, n=c.n, e=etat(n), msgNiveau="", tampon=false;
  var v=res.verdict;
  recents.push(v!=="faux"); if(recents.length>10) recents.shift();
  if(v==="juste"){ serie.bon++; erreursSuite=0; } else if(v==="faux"){ erreursSuite++; }
  else { serie.bon += 0; erreursSuite=0; }

  e.vu++;
  var avant=e.acq;
  if(serie.mode==="entrainement"){
    if(v==="juste"){
      if(c.revision || c.niv>=3 || (n.qcmSeul && c.niv===1)){ e.acq=true; e.n=3; }
      else { e.n=c.niv+1; msgNiveau="Prochaine fois : étape "+e.n+" ("+ETAPES[e.n].toLowerCase()+")."; }
    } else if(v==="presque"){
      e.n=c.niv; serie.file.push({n:n, dans:3});
    } else {
      e.n=Math.max(1, (c.revision?3:c.niv)-1); e.acq=false;
      serie.file.push({n:n, dans:2});
      msgNiveau="Cette notion revient dans un moment"+(e.n<c.niv?", à l'étape "+e.n+".":".");
    }
  } else {
    if(v==="juste" && (c.niv>=3 || n.qcmSeul)){ e.acq=true; e.n=3; }
    if(v==="faux" && e.acq){ e.acq=false; e.n=2; }
  }
  tampon = e.acq && !avant;
  sauver();
  if(v!=="juste") serie.erreurs.push({q:texteSeul(it.q)+(it.grand?" "+it.grand:""), c:it.r[0], d:donne});

  var titres={juste:unDe(["Juste !","Bravo !","Exact !","Bien vu !"]), presque:"Presque !", faux:"Pas tout à fait"};
  var h='<div class="retour '+v+'" role="status"><p class="verdict">'+titres[v]+'</p>';
  if(v!=="juste") h+='<p>La réponse : <b>'+echappe(it.r[0])+'</b></p>';
  if(res.note && v==="juste") h+='<p>'+res.note+'</p>';
  if(res.note && v==="presque") h+='<p>'+res.note+'</p>';
  if(it.explication && v!=="juste") h+='<p>'+it.explication+'</p>';
  if(tampon) h+='<span class="acquis">Acquis</span>';
  if(msgNiveau && serie.mode==="entrainement") h+='<p class="monte doux">'+msgNiveau+'</p>';
  h+='</div>';
  if(erreursSuite>=2 && cfg.lecon && serie.mode==="entrainement")
    h+='<button class="btn" id="k-relire">Relire la leçon<small>Deux erreurs de suite : un petit détour aide souvent</small></button>';
  h+='<button class="btn plein centre" id="k-suite">'+(serie.i+1>=serie.total?"Voir mon résultat":"Question suivante")+'</button>';
  $("k-retour-q").innerHTML=h;
  if($("k-relire")) $("k-relire").onclick=function(){ erreursSuite=0; lecon(); };
  $("k-suite").onclick=function(){ serie.i++; question(); };
  $("k-suite").focus({preventScroll:true});
  $("k-suite").scrollIntoView({block:"nearest", behavior:"smooth"});
}

function fin(){
  var n=serie.total, s=serie.bon, r=s/n, h='';
  var rec = serie.mode==="controle" ? R.enregistrerMeilleurScore(s,n) : null;
  if(serie.mode==="controle") ecrire("dernier-controle:"+fichier, {bon:s, total:n, date:Date.now()});
  h+='<h2>'+(serie.mode==="controle"?"Résultat du contrôle":"Fin de l'entraînement")+'</h2>';
  h+='<p class="score">'+s+' / '+n+'</p>';
  h+='<p>'+(r===1?"Sans faute, bravo !":r>=.75?"Très bien. Encore un petit effort.":r>=.5?"C'est en bonne voie. Relis les corrections, puis recommence.":"Relis la leçon, puis recommence : les questions s'adaptent à toi.")+'</p>';
  if(rec) h+='<p class="doux">Meilleur score au contrôle : '+rec.bon+' / '+rec.total+'</p>';
  var liste=serie.liste, acquises=compteAcquises(liste), apres=null;
  h+='<p class="doux">Notions acquises'+(serie.partie?' dans cette partie':'')+' : '+acquises+' sur '+liste.length+'.</p>';
  if(serie.partie && acquises===liste.length){
    var ip=cfg.parties.indexOf(serie.partie);
    apres = cfg.parties[ip+1] || "bilan";
    h+='<button class="btn plein" id="k-apres">'+(apres==="bilan" ? 'Passer au bilan : faire le contrôle' : 'Passer au point '+(ip+3)+' : '+echappe(apres.titre))+
       '<small>Cette partie est acquise</small></button>';
  }
  h+=carteBilan();
  if(serie.erreurs.length){
    h+='<h3>À revoir</h3><ul class="revoir">';
    serie.erreurs.forEach(function(x){ h+='<li>'+echappe(x.q)+'<span>'+echappe(x.c)+'</span></li>'; });
    h+='</ul>';
  }
  h+='<div class="rangee"><button class="btn plein" id="k-encore">Recommencer</button><button class="btn" id="k-som">Sommaire</button></div>';
  page(h,true);
  var mode=serie.mode, partie=serie.partie;
  $("k-encore").onclick=function(){ demarrer(mode, partie); };
  if($("k-apres")) $("k-apres").onclick=function(){ apres==="bilan" ? demarrer("controle") : demarrer("entrainement", apres); };
  $("k-som").onclick=accueil;
}

/* ====== Meilleur score (lu par la page d'accueil, même format qu'avant) ====== */
R.enregistrerMeilleurScore = function(bon, total){
  var cle="meilleur:"+fichier, prev=lire(cle);
  var mieux = !prev || (bon/total) > (prev.bon/prev.total) ||
              ((bon/total)===(prev.bon/prev.total) && bon>prev.bon);
  if(mieux) ecrire(cle, {bon:bon, total:total});
  return lire(cle);
};

/* ------------------------- Lancement ------------------------- */
R.lancer = function(c){
  cfg=c;
  fichier = location.pathname.split("/").pop() || "index.html";
  var go=function(){ chargerCouleur(); preparerNotions(); squelette(); accueil(); };
  if(document.body) go(); else document.addEventListener("DOMContentLoaded", go);
};
/* Outils partagés pour fabriquer des questions */
R.melange = melange; R.unDe = unDe;
R._serie = function(){ return serie; };   /* pour les tests */
R.entier = function(a,b){ return a+Math.floor(Math.random()*(b-a+1)); };
R.espaces = function(n){ return String(n).replace(/\B(?=(\d{3})+(?!\d))/g," "); };
})();
