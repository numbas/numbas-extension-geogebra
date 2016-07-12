Numbas.addExtension('geogebra',[],function(extension) {
    window.geogebraIdAcc = window.geogebraIdAcc || 0;

    var delay = 10;
    var container;
	$(document).ready(function() {
        container = document.createElement('div');
        container.setAttribute('id','numbasgeogebracontainer');
        container.setAttribute('class','invisible');
        document.body.appendChild(container);
	});

    var injectedDeployScript = false;
    var loadGGB = new Promise(function(resolve,reject) {
        if(window.GGBApplet) {
            resolve(GGBApplet);
        } else {
            if(!injectedDeployScript) {
                var s = document.createElement('script');
                s.setAttribute('type','text/javascript');
                s.setAttribute('src','https://www.geogebra.org/scripts/deployggb.js');
                document.head.appendChild(s);
                injectedDeployScript = true;
            }
            var int = setInterval(function() {
                if(window.GGBApplet) {
                    clearInterval(int);
                    resolve(GGBApplet);
                }
            },delay);
        }
    });

    var injectApplet = function(options) {
        return new Promise(function(resolve,reject) {
            var applet, el;
            options.id = 'numbasGGBApplet'+(window.geogebraIdAcc++);
            options.appletOnLoad = function() {
                var app = applet.getAppletObject();
                resolve({app:app,el:el});
            };
            applet = new GGBApplet(options, true);
            el = document.createElement('div');
            container.appendChild(el);
            applet.inject(el, 'preferHTML5');
        });
    }

    var constructionFinished = function(app) {
        return new Promise(function(resolve,reject) {
            var int = setInterval(function() {
                if(!app.exists) {
                    reject("app.exists does not exist");
                }
                clearInterval(int);
                resolve(app);
            },delay);
        });
    }

    extension.createGeogebraApplet = function(options) {
        var element;
        return loadGGB
            .then(function() { return injectApplet(options)})
            .then(function(d){ element=d.el; return constructionFinished(d.app)})
            .then(function(app) { return new Promise(function(resolve,reject) { resolve({app:app,element:element}); }) })
        ;
    }

    function eval_replacements(replacements) {
        return function(d) {
            return new Promise(function(resolve,reject) {
                var app = d.app;
                replacements.forEach(function(r) {
                    //app.setFixed(r[0],false);
                    var cmd = r[0]+' = '+r[1];
                    var ok = app.evalCommand(cmd);
                    if(!ok) {
                        // try unfixing the object - if the command succeeds this time, the object was just fixed and the command is fine
                        app.setFixed(r[0],false);
                        if(app.evalCommand(cmd)) {
                            app.setFixed(r[0],true);
                        } else {
                            reject("GeoGebra command '"+cmd+"' failed.")
                        }
                    }
                });
                app.setBase64(app.getBase64()); // reset the undo history
                resolve(d);
            });
        }
    }

    /* Link GeoGebra exercises to Numbas question parts
     */
    function link_exercises_to_parts(parts) {
        return function(d) {
            return new Promise(function(resolve,reject) {
                var app = d.app;
                if(app.isExercise()) {
                    for(var toolName in parts) {
                        var part = parts[toolName];
                        part.mark = function() {
                            var results = app.getExerciseResult();
                            var result = results[toolName];
                            this.setCredit(result.fraction,result.hint);
                        }
                        part.validate = function() {
                            return true;
                        }
                        part.suspendData = function() {
                            return {
                                base64: app.getBase64()
                            }
                        }
                    }

                    var check_timeout;
                    function check() {
                        clearTimeout(check_timeout);
                        check_timeout = setTimeout(function() {
                            for(var tool in parts) {
                                parts[tool].setDirty(true);
                            }
                        },100);
                    }
                    app.registerUpdateListener(check);
                    app.registerAddListener(check);
                    app.registerUpdateListener(check);
                }
                resolve(d);
            })
        }
    }

	var types = Numbas.jme.types;
	var funcObj = Numbas.jme.funcObj;
    var TString = types.TString;
    var TNum = types.TNum;
	var TList = types.TList;
    var THTML = types.THTML;

    function clean_material_id(material_id) {
        var m;
        if(m=material_id.match(/(?:geogebra.org\/m|ggbm.at)\/([a-zA-Z0-9]+)$/)) {
            material_id = m[1];
        }
        return material_id;
    }

    function jmeCreateGeogebraApplet(options,replacements,parts) {
        // create a container element, which we'll return
        // when the applet has been loaded, we'll attach it to the container element
        var el = document.createElement('div');
        el.className = 'numbas-geogebra-applet numbas-geogebra-loading';
        el.innerHTML = 'GeoGebra applet loading...';

        var promise = extension.createGeogebraApplet(options)
        .then(eval_replacements(replacements))
        .then(link_exercises_to_parts(parts));

        promise.then(function(d) {
            var interval = setInterval(function() {
                if(el.parentNode) {
                    el.innerHTML = '';
                    el.className = 'numbas-geogebra-applet numbas-geogebra-loaded';
                    el.appendChild(d.element);
                    clearInterval(interval);
                }
            },delay);
        })
        .catch(function(e) {
            var msg = "Problem encountered when creating GeoGebra applet: "+e;
            el.className = 'numbas-geogebra-applet numbas-geogebra-error';
            el.innerHTML = msg;
            throw(new Numbas.Error(msg));
        });

        return {element:el, promise: promise};
    }

    var unwrap = Numbas.jme.unwrapValue;

    function jme_unwrap_replacements(replacements) {
        function unescape_braces(s) {
            return (s+'').replace(/\\\{/g,'{').replace(/\\\}/g,'}');
        }
        return replacements.value.map(function(v) {
            if(v.type!='list') {
                throw(new Error("GeoGebra replacement "+Numbas.jme.display.treeToJME({tok:v})+" is not an array - it should be an array of the form [name,definition]."));
            }
            if(v.value[0].type!='string') {
                throw(new Error("Error in replacement - first element should be the name of an object; instead it's a "+v.value[0].type));
            }
            var name = v.value[0].value;
            var definition
            switch(v.value[1].type) {
                case 'string':
                    definition = v.value[1].value;
                    break;
                case 'number':
                    definition = Numbas.math.niceNumber(v.value[1].value);
                    break;
                case 'vector':
                    var vec = v.value[1].value.map(Numbas.math.niceNumber);
                    definition = '('+vec[0]+','+vec[1]+')';
                    break;
                default:
                    throw(new Error("Error in replacement - second element should be a number, string or a vector, instead it's a "+v.value[1].type));
            }
            return [name,definition];
        });
    }

    extension.scope.addFunction(new funcObj('geogebra_applet',[TString],THTML,function(material_id) {
        return jmeCreateGeogebraApplet({material_id:clean_material_id(material_id)},[],{}).element;
    },{unwrapValues:true}));

    extension.scope.addFunction(new funcObj('geogebra_applet',[TString,TList],THTML,null,{
        evaluate: function(args,scope) {
            var material_id = unwrap(args[0]);
            var replacements = jme_unwrap_replacements(args[1]);
            return new THTML(jmeCreateGeogebraApplet({material_id:clean_material_id(material_id)},replacements,{}).element);
        },
        unwrapValues: true
    }));

    extension.scope.addFunction(new funcObj('geogebra_applet',[TString,TList,TList],THTML,null,{
        evaluate: function(args,scope) {
            var material_id = unwrap(args[0]);
            var replacements = jme_unwrap_replacements(args[1]);
            var partrefs = args[2] ? unwrap(args[2]) : undefined;
            var question = scope.question;
            var parts = {};
            if(question) {
                partrefs.forEach(function(d) {
                    var part = parts[d[0]] = question.getPart(d[1]);
                    if(part.type != 'extension') {
                        throw(new Error("Target of a geogebra exercise must be an extension part; "+d[1]+" is of type "+part.type));
                    }
                    parts[d[0]].suspendData = function() {};
                });
            }
            var result = jmeCreateGeogebraApplet({material_id:clean_material_id(material_id)},replacements,parts);
            var first = true;
            for(var key in parts) {
                var part = parts[key];
                part.mark = function() {};
                part.validate = function() {return true;}
                var pobj = Numbas.store.loadExtensionPart(part);
                if(pobj && pobj.extension_data) {
                    var base64 = pobj.extension_data.base64;
                    if(base64) {
                        result.promise.then(function(d) {
                            d.app.setBase64(base64);
                            var p = part;
                            while(p.parentPart) {
                                p = p.parentPart;
                            }
                            p.submit();
                        });
                        break;
                    }
                }
            }

            return new THTML(result.element);
        },
        unwrapValues:true
    }));

    extension.scope.addFunction(new funcObj('geogebra_base64',[TString,TNum,TNum],THTML,function(ggbBase64,width,height) {
        var options = {
            ggbBase64: ggbBase64,
            width: width,
            height: height
        }
        return jmeCreateGeogebraApplet(options,[],[]);
    }));
});
