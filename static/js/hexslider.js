"use strict";
/* Ideas/questions/notes/plans:
S Idea: Convert internal representation of nodes to a standard integer grid, 
        and have a function that maps grid points (scale + translate) to the
        tiled triangular grid for rendering.
S Idea re walls:
    Player does not "turn", player creates wall at vertex and bounces off of it.
    Walls should not last forever.
    Walls influence all players that run into them.
S Maybe change global e (triangle height) to actually represent triangle edge length. Thoughts?
S Problem!!!! If players end with the same position and direction, they perfectly cover each other
  and can't get away (without something special like a powerup that applies to only one of them).
  To each player, it looks like the other one died.
*/

/*
The data representation of objects is as if they are on a grid, or interpolating
between points along the grid. The grid has edges connecting the vertices like so:
 __ __ __ __ __
|\ |\ |\ |\ |\ |
|_\|_\|_\|_\|_\|
|\ |\ |\ |\ |\ |
|_\|_\|_\|_\|_\|
|\ |\ |\ |\ |\ |
|_\|_\|_\|_\|_\|

When the grid is translated into screen coordinates, it is sheared into a right-leaning rhombus:
         __  __  __  __  __
       /\  /\  /\  /\  /\  /
      /__\/__\/__\/__\/__\/
     /\  /\  /\  /\  /\  /
    /__\/__\/__\/__\/__\/
   /\  /\  /\  /\  /\  /
  /__\/__\/__\/__\/__\/

*/
function toScreenSpace(gc) {
    //To get screen coordinates from grid coordinates, scale and shear into right/leaning rhombus
    var sc = new Point();
    sc.x = gc.x * edge_len + gc.y * half_edge_len;
    sc.y = gc.y * tri_height;
    return sc;
}
function toGridSpace(sc) {
    //Screen coordinates to grid coordinates
    var gc = new Point();
    gc.y = sc.y / tri_height;
    gc.x = (sc.x - gc.y * half_edge_len) / edge_len;
    return gc;
}
function toNearestGridPoint(sc) {
    //Screen coordinates to nearest grid point
    var gc = toGridSpace(sc);
    gc.x = Math.round(gc.x);
    gc.y = Math.round(gc.y);
    return gc;
}

const grid_max_x = 4;
const grid_max_y = 4;
const edge_len = 115.47;
const half_edge_len = edge_len / 2;
const tri_height = Math.sqrt(edge_len*edge_len*3/4);

const r = 300; //circumscribed hexagonal playing field radius (distance from center to middle of edge, not center to corner)
const e = 100; //triangle height; should evenly divide `r`
               //note: this is not triangle edge length.
const s = r * Math.tan(Math.PI/6); //half of a side length (for larger game hexagon)
const t = 2*s*e / r; //triangle edge length

//Note: Optional keybinding char and underscore are chopped off during init_debug_flags()
let DEBUG_FLAGS = {
    't_tracking': false,
    'y_tiling': false,
    'p_paused': false,
    'm_path_markers': true,
    'b_world_border': true,
    'h_hilarious_debug': false,
}

var time_old = -1;

var p_default = {};
var gameSpeed = 0.1;

var testPoint = new Point(-1000, -1000);

// Noteworthy elements of context objects: canvas, bgColor, targetPlayer
var contexts = [];
var players = [];
var candies = [];
var walls = [];
var particles = [];

//Key handling reference: http://unixpapa.com/js/key.html
const KEY_CODE = {
    Enter: 13,
    Space: 32,
    Tab:    9,
    Esc:   27,
    Shift: 16,
    Ctrl:  17,
    Alt:   18,
    Arrow_Left:  37,
    Arrow_Up:    38,
    Arrow_Right: 39,
    Arrow_Down:  40
    };
if (Object.freeze) Object.freeze(KEY_CODE);

function onResize() {
    contexts.forEach(function (ctx) {
        ctx.canvas.width = window.innerWidth * 0.48;
        ctx.canvas.height = window.innerHeight * 0.96;
    });
}

(function () {
    var throttle = function (type, name, obj) {
        obj = obj || window;
        var running = false;
        var func = function () {
            if (running) {
                return;
            }
            running = true;
             requestAnimationFrame(function () {
                obj.dispatchEvent(new CustomEvent(name));
                running = false;
            });
        };
        obj.addEventListener(type, func);
    };
    throttle("resize", "optimizedResize");
}());

// handle event
window.addEventListener("optimizedResize", onResize);


function init() {

    var p1 = new Player();
    p1.keyLeft = 'A'.charCodeAt();  //a=65; d=68;
    p1.keyRight = 'D'.charCodeAt();
    p1.keyForward = 'W'.charCodeAt();
    p1.color = "#0000FF";
    var p2 = new Player();
    p2.keyLeft = KEY_CODE.Arrow_Left;  //<=37; >=39;
    p2.keyRight = KEY_CODE.Arrow_Right;
    p2.keyForward = KEY_CODE.Arrow_Up;
    p2.color = "#FF0000";
    p_default = new Player();
    p1.endVertex = new Point(-2, 0);
    p1.setTrajectory(0);
    p1.step(0);
    p2.endVertex = new Point(2, 0);
    p2.setTrajectory(3);
    p2.step(0);
    players.push(p1);
    players.push(p2);
    
    
    contexts.push(document.getElementById("left").getContext("2d"));
    contexts.push(document.getElementById("right").getContext("2d"));
    contexts[0].bgColor = "#CCCCFF";
    contexts[1].bgColor = "#FFCCCC";
    contexts[0].targetPlayer = players[0];
    contexts[1].targetPlayer = players[1];

    window.onkeydown = event_keydown;
    contexts.forEach(function(ctx) {
        ctx.canvas.onmousedown = event_mdown;
    });

    candies.push(new Candy(generate_random_vertex()));
    candies.push(new Candy(generate_random_vertex()));
    candies.push(new Candy(generate_random_vertex()));

    onResize();
    init_debug_flags();
    requestAnimationFrame(mainloop_init);
}

function init_debug_flags() {
    //Extract keybindings
    let keybinds = {};
    let dbgFlags = {};
    Object.keys(DEBUG_FLAGS).forEach(function (f) {
        let dbgName = f;
        if (f.length > 2 && f[1] == '_') {
            dbgName = dbgName.substr(2);
            dbgFlags[dbgName] = DEBUG_FLAGS[f];
            keybinds[dbgName] = f[0].toUpperCase();
        } else {
            dbgFlags[dbgName] = DEBUG_FLAGS[f];
        }
    });
    //Overwrite DEBUG_FLAGS with keybindings removed from names
    DEBUG_FLAGS = dbgFlags;
    
    //Create html checkboxes to interact with DEBUG_FLAGS
    let box = document.getElementById("flaglist");
    Object.keys(DEBUG_FLAGS).forEach(function (f) {
        let div = document.createElement("div");
        let label = document.createElement("label");
        let input = document.createElement("input");
        input.type="checkbox";
        input.checked = DEBUG_FLAGS[f];
        input.id = f;
        input.onchange = function () {
            DEBUG_FLAGS[f] = input.checked;
        }
        div.className = "item";
        label.appendChild(input);
        if (keybinds[f]) {
            label.appendChild(document.createTextNode('(' + keybinds[f] + ') ' + f));
        } else {
            label.appendChild(document.createTextNode(f));
        }
        div.appendChild(label);
        box.appendChild(div);
    });
    
    DEBUG_FLAGS.keybinds = keybinds;
}

function init_board() {
    //  2    1
    //   \  /
    // 3 -  - 0
    //   /  \
    //  4    5
    board = [];
    rows = [];
}
function Candy(p) {
    this.x = p.x;
    this.y = p.y;
    this.effect = {
        "speedMultiplier": 24,
        "duration": 3
    };
}

function Wall(pos, orient, size) {
    //Size param is optional
    this.x = pos.x;    //Coordinates are in grid space
    this.y = pos.y;
    this.orientation = orient; //Should be 0-2... 0: --, 1: /, 2: \ .
    this.maxSize = size || t/6;
    //this.ttl = 1000;
}
Wall.prototype.ttl = 2000; //ttl is decremented over time for each Wall
Wall.prototype.tIn = 50;
Wall.prototype.tOut = 250;

function update_walls(dt) {
    var i = walls.length;
    while (i--) {
        var w = walls[i]
        w.ttl -= dt;
        if (w.ttl <= 0) { //TTL expired
            //Replace current wall with last wall, and shrink array by 1 element
            walls[i] = walls[walls.length - 1];
            walls.length--;
        }
    }
}
        
function renderWalls(context) {
    var xCoef = Math.cos(Math.PI/3); //coef for x-component when wall on an angle
    var yCoef = Math.sin(Math.PI/3);
    context.lineWidth = 4;
    context.strokeStyle = "#000000";
    context.beginPath();
    walls.forEach(function (wall) {
        var hl = wall.maxSize; //half-length of wall
        //Fade in/out based on ttl
        if (wall.ttl > (Wall.prototype.ttl - wall.tIn)) {
            hl *= (Wall.prototype.ttl - wall.ttl) / wall.tIn;
        } else if (wall.ttl < wall.tOut) {
            hl *= wall.ttl / wall.tOut;
        }
        var hlx = hl * xCoef;  //half-length x when wall on an angle
        var hly = hl * yCoef;
        var w = toScreenSpace(wall);
        switch(wall.orientation) {
            case 0: //Horizontal Wall
                context.moveTo(w.x-hl, w.y);
                context.lineTo(w.x+hl, w.y);
                break;
            case 1: //Forwardslash Wall
                context.moveTo(w.x-hlx, w.y-hly);
                context.lineTo(w.x+hlx, w.y+hly);
                break;
            case 2: //Backslash Wall
                context.moveTo(w.x-hlx, w.y+hly);
                context.lineTo(w.x+hlx, w.y-hly);
                break;
        }
    });
    context.stroke();
}

function Point(x, y) {
    this.x = x;
    this.y = y;
    this.minus = function(p2) {
        return new Point(this.x - p2.x, this.y - p2.y);
    }
    this.plus = function(p2) {
        return new Point(this.x + p2.x, this.y + p2.y);
    }
    this.scale = function(factor) {
        return new Point(this.x * factor, this.y * factor);
    }
    this.normalize = function() {
        var len = Math.sqrt(this.x * this.x + this.y * this.y);
        return new Point(this.x / len, this.y / len);
    }
    this.lerp = function(p2, percent) {
        return new Point(this.x + percent * (p2.x - this.x),
                        this.y + percent * (p2.y - this.y));
    }
    this.clone = function() {
        return new Point(this.x, this.y);
    }
    this.toString = function() {
        return "(" + this.x + ", " + this.y + ")";
    }
}

function Line(x1, y1, x2, y2) {
    this.start = new Point(x1, y1);
    this.end = new Point(x2, y2);
    //@TODO This length is not updated if start or end are modified after Line creation (it's not a function)
    this.length = Math.sqrt((x2-x1)*(x2-x1) + (y2-y1)*(y2-y1));
    this.reverse = function() {
        var temp = this.start;
        this.start = this.end;
        this.end = temp;
    }
    this.lerp = function(percent) {
        return this.start.lerp(this.end, percent);
    }
    this.toString = function() {
        return this.start.toString() + " -> " + this.end.toString();
    }
}

function Player() {
    this.radius = 10;
    this.keyLeft;
    this.keyRight;
    this.keyForward;
    this.color = 0;
    this.speedMultiplier = 12.0;
    this.speedOffset = 0.0;
    this.trail_timer = 0;
    this.trail_period = 100;
    //this.path = new Line(-2 * s, 0, 2 * s, 0);
    this.effects = {};
    this.effectsQueue = [];
    this.universe = TriangleUniverse;
    this.setPos = function(newPos) {
        var tempPos = newPos;
        tempPos *= this.speedMultiplier;
        tempPos -= this.speedOffset;
        if (tempPos < 0) {
            tempPos += this.speedOffset;
            this.speedOffset = 0;
        } else if (tempPos > 1) {
            this.speedOffset += 1;
        }
        this.pos = tempPos;
    };
    this.keyPress = function(key) {
        var direction = 0;
        if (key === this.keyLeft) direction = 1;
        if (key === this.keyRight) direction = -1;
        if (key === this.keyForward) direction = 2;
        if (!direction) return false; //Keypress not handled
        var pa;
        if (direction == 2) {
            pa = this.trajectory % 3;
        } else {
            //Path angle is either +1 to left or -1 to right. +2 is like -1 but without risk of going negative
            pa = (this.trajectory + ((direction == 1) ? 1 : 2)) % 3;
        }
        //Wrap in case endVertex is on grid_max
        var wp = wrapPoint(this.endVertex.clone());
        walls.push(new Wall(wp, pa));
        
        return true; //Keypress handled
    };
    
    this.trajectory = 0;                 //Value 0-5, signifying which direction player is travelling
    this.startVertex = new Point(1, 1);  //Player is moving away from this vertex (grid space)
    this.endVertex = new Point(2, 1);    //Player is moving toward this vertex (grid space)
    this.percent_travelled = 0;    //How far player is between startVertex (0) and endVertex (1)
    this.gridCoord;                //Current player coordinates, in grid space
    this.screenCoord;              //Current player coordinates, in screen space
    //TODO: Decide if setTrajectory should even be here
    this.setTrajectory = function(newTrajectory) {
        //Call this when you're at a vertex and you know which direction the player should go
        this.universe.setPlayerTrajectory(this, newTrajectory);
    };
    this.step = function(pct) {
        //Call this every frame to update player's position
        this.universe.playerStep(this, pct);
    };
    this.resolveVertex = function() {
        //Call this when player has reached or passed a vertex
        this.universe.onPlayerAtVertex(this);
    };
    this.transitionToUniverse = function(uni) {
        this.toUniverse = uni;
        this.universeTransitionPct = 0;
        uni.transitionTo(this);
    };
}

function trajectoryToVector(t) {
    //  2    1
    //   \  /
    // 3 -  - 0
    //   /  \
    //  4    5
    var trajectory_dx = [1, 0, -1, -1,  0,  1];
    var trajectory_dy = [0, 1,  1,  0, -1, -1];
    var dx = trajectory_dx[t];
    var dy = trajectory_dy[t];
    return new Point(dx, dy);
}

function vectorToTrajectory(v) {
    //v should be a Point of which x and y are -1, 0, or 1, and x and y are not equal
    var trajectory_dx = [1, 0, -1, -1,  0,  1];
    var trajectory_dy = [0, 1,  1,  0, -1, -1];
    
    for (var i = 0; i < 6; i++) {
        if (trajectory_dx[i] == v.x && trajectory_dy[i] == v.y)
            return i;
    }
}

function Particle(x, y, lifespan, radius, easeInTime, easeOutTime) {
    this.ttl_orig = lifespan;
    this.ttl = lifespan;
    this.radius_orig = radius;
    this.radius = radius;
    this.color = "#212121";
    this.x = x;
    this.y = y;
    this.opacity = 1.0;
    this.tIn = easeInTime;
    this.tOut = easeOutTime;
}

function update_particles(dt) {
    let i = particles.length;
    while (i--) {
        let p = particles[i]
        p.ttl -= dt;
    }
    particles = particles.filter(function (p) {
        return p.ttl > 0;
    });
}

function wrapPath(start, end) {
    //NOTE: function assumes start/end are never more than 1 grid dimesion away!
    //Also assumes that start is always within bounds, because all starts were once ends.
    //Check if end is out of bounds, and wrap both points if so. Allow end to be within
    //[0, grid_max_x] and [0, grid_max_y] (inclusive of upper range).
    //If both start and end are along grid_max_x or grid_max_y, they are both
    //wrapped over to 0, since 0 and grid_max are equivalent when wrapping.
    if (end.x < 0) {
        start.x += grid_max_x;
        end.x   += grid_max_x;
    } else if ((end.x > grid_max_x) || (end.x == grid_max_x && start.x == grid_max_x)) {
        start.x -= grid_max_x;
        end.x   -= grid_max_x;
    }
    
    if (end.y < 0) {
        start.y += grid_max_y;
        end.y   += grid_max_y;
    } else if ((end.y > grid_max_y) || (end.y == grid_max_y && start.y == grid_max_y)) {
        start.y -= grid_max_y;
        end.y   -= grid_max_y;
    }
}

function wrapPoint(p) {
    //Modifies p!
    while (p.x < 0) p.x += grid_max_x;
    while (p.x >= grid_max_x) p.x -= grid_max_x;
    
    while (p.y < 0) p.y += grid_max_y;
    while (p.y >= grid_max_y) p.y -= grid_max_y;
    return p;
}

function wrapClosestTo(p, target) {
    //In grid space. Return wrapped point p closest to target. Might be outside of rhombus boundary.
    var pWrap = p.clone();
    while (pWrap.x - target.x > grid_max_x/2) pWrap.x -= grid_max_x;
    while (pWrap.x - target.x < -grid_max_x/2) pWrap.x += grid_max_x;
    while (pWrap.y - target.y > grid_max_y/2) pWrap.y -= grid_max_y;
    while (pWrap.y - target.y < -grid_max_y/2) pWrap.y += grid_max_y;
    return pWrap;
}

function getPathAngleIgnoreDirection(line) {
    var result = getPathAngle(line);
    return (result > 2) ? result - 3 : result;
}

function getPathAngle(line) {
    //  2    1
    //   \  /
    // 3 -  - 0
    //   /  \
    //  4    5
    var dx = line.end.x - line.start.x;
    var dy = line.end.y - line.start.y;
    if (dy > -0.0001 && dy < 0.0001){//dy == 0) {    //Horizontal Line
        if (dx > 0) return 0; //going right
        if (dx > 0) return 0; //going right
        else        return 3; //going left
    } else {          //Angled Line
        if (dx > 0) {
            if (dy > 0) return 1;
            else        return 5;
        } else {
            if (dy > 0) return 2;
            else        return 4;
        }
    }
}

function setupTransform(ctx) {
    //center view
    ctx.scale(1, -1); //Invert y-axis
    ctx.translate(ctx.canvas.width / 2, -ctx.canvas.height / 2);
    
    //track the player
    var player = ctx.targetPlayer;
    if (DEBUG_FLAGS.tracking && player) {
        var pos = player.screenCoord;
        ctx.translate(-pos.x, -pos.y);
    } else { //Center the rhombus
        var mid = toScreenSpace(new Point(grid_max_x/2, grid_max_y/2));
        ctx.translate(-mid.x, -mid.y);
    }
}

function renderBG(context) {
    context.save();
    context.beginPath();
    
    if (DEBUG_FLAGS.world_border) {
        renderRhombusBorder(context);
    }
    var player = context.targetPlayer;
    if (player) {
        if (player.toUniverse) {
            player.universe.renderBGTransition(context, player.toUniverse, player.universeTransitionPct);
        } else {
            player.universe.renderBG(context);
        }
    } else { //Default rendering for a context with no player associated
        TriangleUniverse.renderBG(context);
    }
    
    return;
    var a;
    var w;
    //Draw Hexagon
    context.lineWidth = 1;
    //draw horizontal lines
    for (a = -r; a <= r; a += e) {
        w = (r - Math.abs(a)) / r * s + s;
        context.moveTo(-w, a);
        context.lineTo( w, a);
    }
    context.rotate(Math.PI / 3);
    //draw horizontal lines
    for (a = -r; a <= r; a += e) {
        w = (r - Math.abs(a)) / r * s + s;
        context.moveTo(-w, a);
        context.lineTo( w, a);
    }
    context.rotate(Math.PI / 3);
    //draw horizontal lines
    for (a = -r; a <= r; a += e) {
        w = (r - Math.abs(a)) / r * s + s;
        context.moveTo(-w, a);
        context.lineTo( w, a);
    }
    
    context.stroke();
    context.restore();
}

function renderRhombusBorder(context) {
    context.save();
    context.beginPath();
    context.lineWidth = 10;
    context.strokeStyle = "#DDDDDD";
    
    var p1 = toScreenSpace(new Point(0,0));
    var p2 = toScreenSpace(new Point(grid_max_x,0));
    var p3 = toScreenSpace(new Point(grid_max_x,grid_max_y));
    var p4 = toScreenSpace(new Point(0,grid_max_y));
    context.moveTo(p1.x, p1.y);
    context.lineTo(p2.x, p2.y);
    context.lineTo(p3.x, p3.y);
    context.lineTo(p4.x, p4.y);
    context.lineTo(p1.x, p1.y);
    
    context.stroke();
    context.restore();
}

const TriangleUniverse = {
    renderBG: function(context) {
        context.save();
        context.beginPath();
        
        var bottomLeft = toScreenSpace(new Point(0,0));
        var y1 = 0;
        var y2 = bottomLeft.y;
        var xStart = bottomLeft.x;
        for(var row = 0; row < grid_max_y; row++) {
            //For a right-leaning rhombus, every row starts with an up-oriented triangle
            //and ends with a down-oriented triangle
            var uporient = true;
            y1 = y2;
            y2 = y1 + tri_height;
            var x1 = xStart - half_edge_len;
            var x2 = x1 + half_edge_len;
            var x3 = x2 + half_edge_len;
            for(var col = 0; col < 2*grid_max_x; col++) {
                x1 = x2;
                x2 = x3;
                x3 += half_edge_len;
                
                if (uporient) {
                    //draw triangle with pointy top
                    context.moveTo(x1, y1);
                    context.lineTo(x2, y2);
                    context.lineTo(x3, y1);
                    context.lineTo(x1, y1);
                } else {
                    //draw triangle with pointy bottom
                    context.moveTo(x1, y2);
                    context.lineTo(x3, y2);
                    context.lineTo(x2, y1);
                    context.lineTo(x1, y2);
                }
                uporient = !uporient;
            }
            xStart += half_edge_len
        }
        
        context.stroke();
        context.restore();
    },
    
    renderBGTransition: function(context, toUniverse, pct) {
        if (toUniverse === FlowerUniverse) {
            toUniverse.renderBGTransition(context, this, 1-pct);
        } else {
            this.renderBG(context);
        }
    },
    
    playerStep: function(player, pct) {
        //Step forward pct% of an edge length
        player.percent_travelled += pct;
        player.gridCoord = player.startVertex.lerp(player.endVertex, player.percent_travelled);
        player.screenCoord = toScreenSpace(player.gridCoord);
    },
    
    onPlayerAtVertex: function(player) {
        //Player has reached (or passed) endVertex
        
        //Look for walls at this vertex
        
        // 4 2    1 2
        //    \  /
        //8 3 -  - 0  1
        //    /  \
        //16 4    5 32
        var turnLeft = false;
        var turnRight = false;
        var ignoringParallel = false;
        var pd = player.trajectory; // player direction
        
        var leftWall = (pd + 1) % 3; //This wall orientation # will bounce player left
        var rightWall = (pd + 2) % 3;
        var parallelWall = pd % 3;
        var pos = wrapPoint(player.endVertex.clone());
        walls.forEach(function (wall) {
            if (pos.x == wall.x && pos.y == wall.y) {
                var o = wall.orientation;
                turnLeft |= (o == leftWall);
                turnRight|= (o == rightWall);
                ignoringParallel |= (o == parallelWall);
            }
        });
        if (turnRight && turnLeft) {
                //Turn around
                log('turn around');
                pd += 3;
        } else if (turnRight) {
            //Turn Right
            log('turn right');
            pd += 4; //Same as -2 in mod 6
        } else if (turnLeft) {
            //Turn Left
            log('turn left');
            pd += 2;
        }
        if (pd >= 6) pd -= 6;
        player.setTrajectory(pd);
    },
    
    setPlayerTrajectory: function(player, newTrajectory) {
        player.trajectory = newTrajectory;
        player.startVertex = player.endVertex;
        var traj = trajectoryToVector(newTrajectory);
        player.endVertex = player.endVertex.plus(traj);
        wrapPath(player.startVertex, player.endVertex);
        player.step(-1); //Reset percent_travelled and set new coords
        //if (player == players[0]) log('player1 at ' + player.startVertex + ' screen ' + player.screenCoord);
    },
    
    transitionTo: function(player) {
        log("Player transitioning to Triangle Universe.");
    }
};
Object.freeze(TriangleUniverse);

const FlowerUniverse = {
    renderBG: function(context, radius = edge_len) {
        context.save();
        context.beginPath();
        
        var bottomLeft = toScreenSpace(new Point(0,0));
        var y1 = 0;
        var y2 = bottomLeft.y;
        var xStart = bottomLeft.x;
        for(var row = 0; row < grid_max_y; row++) {
            //For a right-leaning rhombus, every row starts with an up-oriented triangle
            //and ends with a down-oriented triangle
            var uporient = true;
            y1 = y2;
            y2 = y1 + tri_height;
            var x1 = xStart - half_edge_len;
            var x2 = x1 + half_edge_len;
            var x3 = x2 + half_edge_len;
            for(var col = 0; col < 2*grid_max_x; col++) {
                x1 = x2;
                x2 = x3;
                x3 += half_edge_len;
                
                if (uporient) {
                    drawArc(x2, y2, x1, y1, radius, context);
                    drawArc(x3, y1, x2, y2, radius, context);
                    drawArc(x1, y1, x3, y1, radius, context);
                } else {
                    drawArc(x3, y2, x1, y2, radius, context);
                    drawArc(x2, y1, x3, y2, radius, context);
                    drawArc(x1, y2, x2, y1, radius, context);
                }
                uporient = !uporient;
            }
            xStart += half_edge_len
        }
        
        context.stroke();
        context.restore();
    },
    
    renderBGTransition: function(context, toUniverse, pct) {
        if (toUniverse === TriangleUniverse) {
            var radius = edge_len / Math.clamp(1 - pct, .01, 1);
            this.renderBG(context, radius);
        } else {
            this.renderBG(context);
        }
    },
    
    playerStep: function(player, pct) {
        //Step forward pct% over a 60deg arc
        player.percent_travelled += pct;
        var orbitVertex = wrapClosestTo(player.orbitVertex, player.startVertex);
        var startTraj = vectorToTrajectory(player.startVertex.minus(orbitVertex));
        var endTraj   = vectorToTrajectory(player.endVertex.minus(orbitVertex));
        //0deg and 360deg are equivalent, so make sure we use the right value to lerp between
        if (startTraj == 0 && endTraj == 5) startTraj = 6;
        if (startTraj == 5 && endTraj == 0) endTraj = 6;
            
        var lerpRadians = Math.PI / 3 * (startTraj + (endTraj - startTraj) * player.percent_travelled);
        var s = toScreenSpace(orbitVertex);
        s.x += Math.cos(lerpRadians) * edge_len;
        s.y += Math.sin(lerpRadians) * edge_len;
        player.screenCoord = s;
        player.gridCoord = wrapPoint(toGridSpace(player.screenCoord));
    },
    
    onPlayerAtVertex: function(player) {
        //Player has reached (or passed) endVertex
        
        //Look for walls at this vertex
        
        //   2    1
        //    \  /
        //  3 -  - 0
        //    /  \
        //   4    5
        var turnLeft = false;
        var turnRight = false;
        var turnParallel = false;
        var pd = player.trajectory; // player direction
        
        var leftWall = (pd + 1) % 3; //This wall orientation # will bounce player left
        var rightWall = (pd + 2) % 3;
        var parallelWall = pd % 3;
        var pos = wrapPoint(player.endVertex.clone());
        walls.forEach(function (wall) {
            if (pos.x == wall.x && pos.y == wall.y) {
                var o = wall.orientation;
                turnLeft |= (o == leftWall);
                turnRight|= (o == rightWall);
                turnParallel |= (o == parallelWall);
            }
        });
        if (turnRight && turnLeft) {
            //Turn around
            log('turn around');
            player.orbitDirection = -player.orbitDirection; //1=ccw, -1=cw
            pd += 3;
        } else if (turnRight) {
            //Turn Right
            log('turn right');
            pd += 4; //Same as -2 in mod 6
        } else if (turnLeft) {
            //Turn Left
            log('turn left');
            pd += 2;
        } else if (turnParallel) {
            //Go straight
            log('go straight');
        } else {
            //Continue orbiting
            pd += player.orbitDirection;
        }
        if (pd >= 6) pd -= 6;
        player.setTrajectory(pd);
        //player.setTrajectory((player.trajectory + player.orbitDirection + 6) % 6);
    },
    
    setPlayerTrajectory: function(player, newTrajectory) {
        player.trajectory = newTrajectory;
        player.startVertex = player.endVertex;
        var traj = trajectoryToVector(newTrajectory);
        player.endVertex = player.endVertex.plus(traj);
        wrapPath(player.startVertex, player.endVertex);
        
        //Compute orbitVertex
        var t = player.trajectory + player.orbitDirection;
        if (t < 0) t += 6;
        if (t > 5) t -= 6;
        var tv = trajectoryToVector(t);
        player.orbitVertex = wrapPoint(player.startVertex.plus(tv));
        
        player.step(-1); //Reset percent_travelled and set new coords
        //if (player == players[0]) log('player1 at ' + player.startVertex + ' screen ' + player.screenCoord);
    },
    
    transitionTo: function(player) {
        log("Player transitioning to Flower Universe.");
        //Choose an orbit vertex to the right or left
        //ORRRR maybe just have a boolean for clockwise or CCW rotation
        //Arbitrarily turn left for now
        player.orbitDirection = 1; //1=ccw, -1=cw
        var t = player.trajectory + player.orbitDirection;
        if (t < 0) t += 6;
        if (t > 5) t -= 6;
        var tv = trajectoryToVector(t);
        player.orbitVertex = wrapPoint(player.endVertex.plus(tv));
    }
};
Object.freeze(FlowerUniverse);

function drawArc(x1, y1, x2, y2, radius, context) {
    //midpoint
    var mx = x1 + (x2-x1)/2;
    var my = y1 + (y2-y1)/2;
    //(px, py) is perpendicular vector with length equal to p2-p1
    var px = y2-y1;
    var py = x1-x2;
    var d12_sq = px*px + py*py
    var d12 = Math.sqrt(d12_sq);
    var padj = Math.sqrt(radius*radius - d12_sq/4);
    
    
    //(cx, cy) is center of arc
    var cx = mx + px * padj / d12;
    var cy = my + py * padj / d12;
    var startAngle = Math.atan2(y1-cy, x1-cx);
    var endAngle = Math.atan2(y2-cy, x2-cx);
    
    if (DEBUG_FLAGS.hilarious_debug) {
        context.moveTo(mx, my);
        context.lineTo(cx, cy);
        context.arc(cx, cy, radius, startAngle, endAngle, true);
        context.lineTo(cx, cy);
    } else {
        context.moveTo(x1, y1);
        context.arc(cx, cy, radius, startAngle, endAngle, true);
    }
}

function renderPlayer(player, context) {
    var pos = player.screenCoord;
    context.strokeStyle = player.color;
    context.translate(pos.x, pos.y);
    //context.rotate(-Math.PI / 4);
    context.rotate((4*Math.PI*player.trajectory - 3*Math.PI) / 12);
    context.beginPath();
    context.arc(0, 0, player.radius, 0, 2 * Math.PI, false);
    context.lineTo(player.radius*1.5, player.radius*1.5);
    context.lineTo(0, player.radius);
    context.stroke();
    //context.rotate(Math.PI / 4);
    context.rotate((-4*Math.PI*player.trajectory + 3*Math.PI) / 12);
    context.translate(-pos.x, -pos.y);

    //@TEST CODE marks the start and end vertices that player is lerping on
    if (DEBUG_FLAGS.path_markers) {
        context.beginPath();
        pos = toScreenSpace(player.startVertex);
        context.arc(pos.x, pos.y, player.radius-5, 0, 2 * Math.PI, false);
        context.stroke();
        context.beginPath();
        pos = toScreenSpace(player.endVertex);
        context.arc(pos.x, pos.y, player.radius-5, 0, 2 * Math.PI, false);
        context.stroke();
        if (player.orbitVertex) {
            context.beginPath();
            pos = toScreenSpace(player.orbitVertex);
            context.arc(pos.x, pos.y, player.radius*2, 0, 2 * Math.PI, false);
            context.stroke();
        }
    }
}

function renderParticles(context) {
    particles.forEach(function (particle) {
        context.fillStyle = particle.color;
        if (particle.ttl < particle.tOut) {
            context.globalAlpha = (particle.ttl / particle.tOut);
            //radius increases to double over the tOut period.
            particle.radius = particle.radius_orig * (2 - particle.ttl / particle.tOut);
        } else if (particle.ttl > particle.ttl_orig - particle.tIn) {
            let ratio = (particle.ttl - particle.ttl_orig) / -particle.tIn;
            particle.radius = (ratio * 0.5 + 0.5) * particle.radius_orig;
            context.globalAlpha = ratio;
        }
        context.beginPath();
        context.arc(particle.x, particle.y, particle.radius, 0, 2 * Math.PI, false);
        context.fill();
    });
    context.globalAlpha = 1.0;
}

function renderCandies(ctx) {
    ctx.strokeStyle = "#009900";
    candies.forEach(function (candy) {
        var p = toScreenSpace(new Point(candy.x, candy.y));
        ctx.strokeRect(p.x - 10, p.y - 10, 20, 20);
    });
}

function renderClear(ctx) {
    ctx.resetTransform();
    
    ctx.fillStyle = ctx.bgColor;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

function renderTiledGame() {
    /* hexagon tiling positions
    const positions = 
        [ [0, 0]
        , [0, +2 * r]
        , [0, -2 * r]
        , [-3 * s, r]
        , [+3 * s, r]
        , [-3 * s, -r]
        , [+3 * s, -r]
        ];*/
    var dx = grid_max_x * edge_len;
    var dy = grid_max_y * tri_height;
    //Rhombus tiling positions
    const positions = 
        [ [-dx*3/2, -dy]
        , [dx, 0]
        , [dx, 0]
        , [-dx*3/2, dy]
        , [dx, 0]
        , [dx, 0]
        , [-dx*3/2, dy]
        , [dx, 0]
        , [dx, 0]];
        
    contexts.forEach(function (ctx) {
        renderClear(ctx);
        setupTransform(ctx);
        positions.forEach(function (pos) {
            ctx.save();
            ctx.translate(pos[0], pos[1]);
            renderGameInContext(ctx);
            ctx.restore();
        });
    });
}
function renderGame() {
    contexts.forEach(function (ctx) {
        renderClear(ctx);
        setupTransform(ctx);
        renderGameInContext(ctx);
    });
}

function renderGameInContext(ctx) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#000000";
    renderBG(ctx);

    ctx.lineWidth = 5;
    //Player who is primary in this context should be drawn last (always on top)
    var primaryPlayer = ctx.targetPlayer;
    players.forEach(function (p) {
        if (p != primaryPlayer) {
            renderPlayer(p, ctx);
        }
    });
    if (primaryPlayer) {
        renderPlayer(primaryPlayer, ctx);
    }

    ctx.strokeStyle = "#009900";
    ctx.strokeRect(testPoint.x - 5, testPoint.y - 5, 10, 10);

    renderCandies(ctx);
    renderWalls(ctx);
    renderParticles(ctx);
}

function step(time = 50) {
    main(time_old + time);
    //blank
}

function mouseEvent_to_world(mouseEvent, canvas) {
    var y = canvas.height / 2 - mouseEvent.offsetY;
    var x = mouseEvent.offsetX - canvas.width / 2;
    return new Point(x, y);
}

function snap_to_tri_grid(point) {
    var temp = Math.round(point.y / e);
    point.y = temp * e;
    if (temp & 1) {
        point.x = Math.round((point.x - t/2) / t) * t + t/2;
    } else {
        point.x = Math.round(point.x / t) * t;
    }
}

function event_mdown(mouseEvent) {
    testPoint = mouseEvent_to_world(mouseEvent, contexts[1].canvas);
    if (DEBUG_FLAGS.tracking) { //Center on tracked player
        if (mouseEvent.clientX >= contexts[1].canvas.offsetLeft) { //Clicked right canvas
            testPoint = testPoint.plus(contexts[1].targetPlayer.screenCoord);
        } else { //Clicked left canvas
            testPoint = testPoint.plus(contexts[0].targetPlayer.screenCoord);
        }
    } else { //Center on middle of rhombus
        testPoint = testPoint.minus(toScreenSpace(new Point(grid_max_x/2, grid_max_y/2)));
    }
    candies.push(new Candy(wrapPoint(toNearestGridPoint(testPoint))));
    snap_to_tri_grid(testPoint);
}

function event_keydown(event) {
    var c = String.fromCharCode(event.keyCode);
    //console.log('keyCode ' + event.keyCode + ', char ' + c);
    
    //Check if debug flags handle keypress
    Object.keys(DEBUG_FLAGS.keybinds).forEach(function (k) {
        if (c === DEBUG_FLAGS.keybinds[k]) {        
            let chkbox = document.getElementById(k);
            chkbox.checked = !chkbox.checked;
            chkbox.onchange();
        }
    });
    
    //Check if players handle keypress
    for(let i = 0; i < players.length; i++) {
        if (players[i].keyPress(event.keyCode)) break;
    }
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generate_random_vertex() {
    var vtx = new Point(randomInt(0, grid_max_x-1), randomInt(0, grid_max_y-1));
    return vtx;
}

function update_player(player, delta) {
    var msPerEdge = 835;
    //TODO: Should player position be updated here or in physics()?
    player.step(delta/msPerEdge);

    //periodically poop particles
    //This is done by time, although could be by distance instead...
    player.trail_timer += delta;
    if (player.trail_timer > player.trail_period) {
        player.trail_timer = player.trail_timer % player.trail_period;
        let breadcrumb = new Particle(player.screenCoord.x, player.screenCoord.y, 1000, player.radius / 2, 500, 500);
        particles.push(breadcrumb);
    }

    if (player.percent_travelled < 1) return; //Player is still on current line
    
    //Player has reached (or passed) endVertex
    player.resolveVertex();
    
    Object.keys(player.effects).forEach(function (effect) {
        //effect is a key in the player.effects dictionary
        player.effects[effect] -= 1;
        if (player.effects[effect] <= 0) {
            
            //corner case?
            if (effect === "speedMultiplier") {
                player.speedOffset = player.speedOffset * p_default.speedMultiplier / player.speedMultiplier;
            }

            delete player.effects[effect];
            player[effect] = p_default[effect];
        }
    });

    player.effectsQueue.forEach(function (effect) {
        //testing:
        var duration = effect.duration;
        delete effect.duration;
        var power = Object.keys(effect)[0];
        var value = effect[power];
        player.effects[power] = duration;
        player[power] = value;

        //corner case?
        if (power === "speedMultiplier") {
            player.speedOffset = player.speedOffset * player.speedMultiplier / p_default.speedMultiplier;
        }
    });
    player.effectsQueue = [];
}

function collide_candies(player) {
    var pos = wrapPoint(player.gridCoord.clone());
    candies = candies.filter(function (candy) {
        //TODO make this test better. maybe only test when player crosses a vertex
        if ((pos.x - candy.x) * (pos.x - candy.x) + (pos.y - candy.y) * (pos.y - candy.y) < .01) {
            player.effectsQueue.push(candy.effect);
            
            if (player.universeTransitionPct > 0.9) { //HACK because we are eating candies before reaching the vertex
                player.universe = player.toUniverse;
                player.toUniverse = undefined; //Setting to undefined is faster than delete
                player.universeTransitionPct = undefined;
            }
            var newUniverse = (player.universe === TriangleUniverse) ? FlowerUniverse : TriangleUniverse;
            player.transitionToUniverse(newUniverse);
            return false;
        }
        return true;
    });
}

function physics(delta) {
    players.forEach(collide_candies);
    players.forEach(function (p) {
        if (p.toUniverse) { //If player is transitioning to new universe
            //TODO: render never happens at universeTransitionPct == 0, is this a bad thing?
            p.universeTransitionPct += delta / 835; //TODO: Refactor. 835 is the msPerEdge value in update_player
            if (p.universeTransitionPct >= 1) { //Done transitioning to new universe
                p.universe = p.toUniverse;
                p.toUniverse = undefined; //Setting to undefined is faster than delete
                p.universeTransitionPct = undefined;
            }
        }
        update_player(p, delta);
    });
    
    update_walls(delta);

    update_particles(delta);
}

function mainloop_init(timestamp) {
    time_old = timestamp;
    window.requestAnimationFrame(mainloop);
}

function mainloop(timestamp) {
    var delta = timestamp - time_old;
    time_old = timestamp;

    if (DEBUG_FLAGS.paused) {
        delta = 0
    }
    physics(delta);

    if (DEBUG_FLAGS.tiling) {
        renderTiledGame();
    } else {
        renderGame();
    }
    window.requestAnimationFrame(mainloop);
}

if (Math.clamp === undefined) {
    Math.clamp = (num, min, max) => (num <= min) ? min : (num >= max) ? max : num;
}
//To save on typing
var log = console.log;