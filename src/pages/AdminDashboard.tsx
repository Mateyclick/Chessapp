import React, { useState, useEffect } from 'react';
import { useSocket } from '../context/SocketContext';
import ChessPuzzleSetup from '../components/admin/ChessPuzzleSetup';
import PlayerList from '../components/shared/PlayerList';
import GameSessionInfo from '../components/admin/GameSessionInfo';
import GameControls from '../components/admin/GameControls';

interface Player {
  id?: string;
  nickname: string;
  score: number;
}

interface PlayerProgressInfo {
  id: string;
  nickname: string;
  lastAttemptedMove?: string;
  status: 'solving' | 'completed' | 'failed' | 'waiting' | 'correct_step';
  time?: number;
  opponentMoveSAN?: string;
}

interface PuzzleState {
  position: string;
  mainLine: string;
  timer: number;
  points: number;
}

const AdminDashboard: React.FC = () => {
  const { socket, isConnected } = useSocket();

  const [sessionCreated, setSessionCreated] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [numPuzzles, setNumPuzzles] = useState(3);
  const [currentPuzzleIndex, setCurrentPuzzleIndex] = useState(0);
  const [puzzleActive, setPuzzleActive] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [puzzles, setPuzzles] = useState<Array<PuzzleState>>([]);
  const [sessionPlayers, setSessionPlayers] = useState<Player[]>([]);
  const [playerProgress, setPlayerProgress] = useState<Record<string, PlayerProgressInfo>>({});
  const [puzzleLaunchedAt, setPuzzleLaunchedAt] = useState<number | null>(null);

  const handleCreateSession = () => {
    if (socket && isConnected && !sessionCreated) {
      socket.emit('create_session', { numPuzzles });
    } else if (socket && isConnected && sessionCreated) {
      alert("La sesión ya está creada. Para cambiar el número de problemas, por favor, reinicia la sesión actual o crea una nueva.");
    }
  };

  useEffect(() => {
    if (!socket) return;

    const handleSessionCreated = (data: { sessionId: string }) => {
      setSessionId(data.sessionId);
      setSessionCreated(true);
      const initialPuzzles = Array(numPuzzles).fill(null).map(() => ({
        position: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
        mainLine: '',
        timer: 60,
        points: 3
      }));
      setPuzzles(initialPuzzles);
      setSessionPlayers([]); 
      setPlayerProgress({}); 
    };

    const handlePlayerJoinedSession = (data: {
        playerId: string; 
        nickname: string; 
        score: number;    
        players: Player[]; 
    }) => {
      console.log('[AdminDashboard] Evento player_joined (otro jugador se unió/actualización lista) recibido, data:', data);
      setSessionPlayers(data.players || []); 

      if (data.playerId && data.nickname) {
          setPlayerProgress(prev => ({
            ...prev,
            [data.playerId]: {
              id: data.playerId,
              nickname: data.nickname,
              status: 'waiting',
            }
          }));
      }
    };
    
    const handlePlayerLeft = (data: {
        playerId: string;
        nickname: string;
        players: Player[]; 
    }) => {
        console.log('[AdminDashboard] Evento player_left recibido:', data.nickname);
        setSessionPlayers(data.players || []);
        setPlayerProgress(prev => {
            const newState = {...prev};
            delete newState[data.playerId];
            return newState;
        });
    };

    const handleAdminPlayerProgress = (data: {
        playerId: string;
        nickname: string;
        attemptedMoveSAN: string;
        timestamp: number;
        status: 'solving_correct_step' | 'solving_incorrect_step';
        opponentMoveSAN?: string;
    }) => {
      console.log('[AdminDashboard] Evento admin_player_progress recibido:', data);
      const timeSoFar = puzzleLaunchedAt ? parseFloat(((data.timestamp - puzzleLaunchedAt) / 1000).toFixed(1)) : undefined;
      setPlayerProgress(prev => ({
        ...prev,
        [data.playerId]: {
          ...(prev[data.playerId] || { id: data.playerId, nickname: data.nickname, status: 'solving' }),
          lastAttemptedMove: data.attemptedMoveSAN,
          status: data.status === 'solving_correct_step' ? 'correct_step' : 'solving',
          time: timeSoFar,
          opponentMoveSAN: data.opponentMoveSAN,
        }
      }));
    };

    const handlePlayerCompleted = (data: {
        playerId: string;
        nickname: string;
        finalFEN?: string;
        timeTakenMs?: number;
    }) => {
      console.log('[AdminDashboard] Evento player_completed_sequence recibido:', data);
      const timeTakenSec = data.timeTakenMs ? parseFloat((data.timeTakenMs / 1000).toFixed(1)) : undefined;
      setPlayerProgress(prev => ({
        ...prev,
        [data.playerId]: {
          ...(prev[data.playerId] || { id: data.playerId, nickname: data.nickname }), 
          status: 'completed',
          time: timeTakenSec,
          lastAttemptedMove: prev[data.playerId]?.lastAttemptedMove, 
        }
      }));
    };

    const handlePlayerFailed = (data: {
        playerId: string;
        nickname: string;
        lastAttemptedMove?: string;
    }) => {
      console.log('[AdminDashboard] Evento player_failed_sequence recibido:', data);
      const timeNow = puzzleLaunchedAt ? parseFloat(((Date.now() - puzzleLaunchedAt) / 1000).toFixed(1)) : undefined;
      setPlayerProgress(prev => ({
        ...prev,
        [data.playerId]: {
          ...(prev[data.playerId] || { id: data.playerId, nickname: data.nickname }),
          status: 'failed',
          time: timeNow,
          lastAttemptedMove: data.lastAttemptedMove || prev[data.playerId]?.lastAttemptedMove,
        }
      }));
    };

    const handlePuzzleLaunchedForAdmin = (data: { /* payload del puzzle_launched del servidor */ }) => {
      console.log('[AdminDashboard] Evento puzzle_launched (detectado por admin) recibido:', data);
      setPuzzleActive(true);
      setShowResults(false);
      const launchedTime = Date.now();
      setPuzzleLaunchedAt(launchedTime);

      const newProgress: Record<string, PlayerProgressInfo> = {};
      sessionPlayers.forEach(player => {
        if (player.id) { 
            newProgress[player.id] = {
                id: player.id,
                nickname: player.nickname,
                status: 'waiting', 
                time: undefined,
                lastAttemptedMove: undefined,
                opponentMoveSAN: undefined,
            };
        }
      });
      setPlayerProgress(newProgress);
      console.log('[AdminDashboard] Progreso de jugadores reseteado para nuevo puzzle.');
    };

    socket.on('session_created', handleSessionCreated);
    socket.on('player_joined', handlePlayerJoinedSession); 
    socket.on('player_left', handlePlayerLeft); 
    socket.on('admin_player_progress', handleAdminPlayerProgress);
    socket.on('player_completed_sequence', handlePlayerCompleted);
    socket.on('player_failed_sequence', handlePlayerFailed);
    socket.on('puzzle_launched', handlePuzzleLaunchedForAdmin); 

    return () => {
      socket.off('session_created', handleSessionCreated);
      socket.off('player_joined', handlePlayerJoinedSession);
      socket.off('player_left', handlePlayerLeft);
      socket.off('admin_player_progress', handleAdminPlayerProgress);
      socket.off('player_completed_sequence', handlePlayerCompleted);
      socket.off('player_failed_sequence', handlePlayerFailed);
      socket.off('puzzle_launched', handlePuzzleLaunchedForAdmin);
    };
  }, [socket, numPuzzles, sessionPlayers, puzzleLaunchedAt, puzzleActive]);

  const updatePuzzle = (puzzleData: PuzzleState) => {
    if (!socket || !sessionId || !puzzles) return;
    const updatedPuzzles = [...puzzles];
    if (updatedPuzzles[currentPuzzleIndex]) {
      updatedPuzzles[currentPuzzleIndex] = puzzleData;
      setPuzzles(updatedPuzzles);
    } else if (puzzles.length === 0 && currentPuzzleIndex === 0) {
      updatedPuzzles[0] = { ...puzzleData };
      setPuzzles(updatedPuzzles);
    }
    socket.emit('update_puzzle', {
      sessionId,
      puzzleIndex: currentPuzzleIndex,
      puzzle: puzzleData
    });
  };

  const launchPuzzle = () => {
    if (!socket || !sessionId || !puzzles || puzzles.length === 0) return;
    const currentPuzzleDetails = puzzles[currentPuzzleIndex];
    if (!currentPuzzleDetails || !currentPuzzleDetails.position || !currentPuzzleDetails.mainLine) {
      alert('Por favor, configura primero el problema con una posición FEN y una línea principal de jugadas (SAN).');
      return;
    }
    socket.emit('launch_puzzle', {
      sessionId,
      puzzleIndex: currentPuzzleIndex
    });
  };

  const revealResults = () => {
    if (!socket || !sessionId) return;
    socket.emit('reveal_results', { sessionId }); 
    setShowResults(true);
    setPuzzleActive(false); 
  };

  const nextPuzzle = () => {
    if (!socket || !sessionId) return;
    if (currentPuzzleIndex < puzzles.length - 1) { 
      const nextIdx = currentPuzzleIndex + 1;
      setCurrentPuzzleIndex(nextIdx);
      setPuzzleActive(false); 
      setShowResults(false);
      socket.emit('next_puzzle', { sessionId }); 
    } else {
      alert('Este es el último problema de la sesión. Puedes revelar resultados o reiniciar la sesión.');
    }
  };

  const resetSession = () => {
    setSessionCreated(false);
    setSessionId('');
    setCurrentPuzzleIndex(0);
    setPuzzleActive(false);
    setSessionPlayers([]);
    setPlayerProgress({});
    setShowResults(false);
    setPuzzles([]);
    setNumPuzzles(3); 
    setPuzzleLaunchedAt(null);
    console.log("AdminDashboard: Sesión reseteada localmente.");
  };

  if (!isConnected && !sessionCreated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
        <div className="animate-pulse text-lg text-yellow-600 font-medium">
          Conectando al servidor para iniciar...
        </div>
      </div>
    );
  }

  const defaultPuzzleData: PuzzleState = {
    position: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
    mainLine: '',
    timer: 60,
    points: 3,
  };

  const currentPuzzleDataForChild: PuzzleState =
    (puzzles && puzzles[currentPuzzleIndex])
      ? puzzles[currentPuzzleIndex]
      : defaultPuzzleData;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-6 space-y-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h1 className="text-2xl font-bold text-gray-800 mb-4">
            Trebejos Game - Panel de Administración
          </h1>
          
          {!sessionCreated ? (
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="w-full sm:w-auto flex items-center gap-3">
                <label htmlFor="numPuzzlesInput" className="text-sm font-medium text-gray-700 whitespace-nowrap">
                  Número de Problemas:
                </label>
                <input
                  type="number"
                  id="numPuzzlesInput"
                  value={numPuzzles}
                  onChange={(e) => setNumPuzzles(Math.max(1, parseInt(e.target.value) || 1))}
                  min="1"
                  className="px-3 py-2 border border-gray-300 rounded-lg w-24 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <button
                onClick={handleCreateSession}
                className="w-full sm:w-auto px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                disabled={!isConnected}
              >
                Crear Sesión ({numPuzzles} Problemas)
              </button>
              {(!isConnected) && 
                <span className="text-sm text-yellow-600">
                  Esperando conexión para crear sesión...
                </span>
              }
            </div>
          ) : (
            <GameSessionInfo
              sessionId={sessionId}
              currentPuzzleIndex={currentPuzzleIndex}
              totalPuzzles={puzzles.length}
              puzzleActive={puzzleActive}
              showResults={showResults}
            />
          )}
        </div>

        {sessionCreated && puzzles && puzzles.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h2 className="text-xl font-bold text-gray-800 mb-4">
                  Configuración del Problema (#{currentPuzzleIndex + 1} de {puzzles.length})
                </h2>
                <ChessPuzzleSetup
                  puzzle={currentPuzzleDataForChild}
                  onUpdate={updatePuzzle}
                  disabled={puzzleActive || showResults}
                />
                <div className="mt-6 pt-6 border-t border-gray-100">
                  <GameControls
                    puzzleActive={puzzleActive}
                    showResults={showResults}
                    isLastPuzzle={currentPuzzleIndex === puzzles.length - 1}
                    onLaunch={launchPuzzle}
                    onReveal={revealResults}
                    onNext={nextPuzzle}
                    onReset={resetSession}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h2 className="text-xl font-bold text-gray-800 mb-4">
                  Jugadores Conectados ({(sessionPlayers || []).length})
                </h2>
                <PlayerList players={sessionPlayers || []} />
              </div>

              {(puzzleActive || showResults) && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                  <h2 className="text-xl font-bold text-gray-800 mb-4">
                    Progreso Jugadores (Problema #{currentPuzzleIndex + 1})
                  </h2>
                  {Object.keys(playerProgress).length > 0 ? (
                    <div className="space-y-3">
                      {sessionPlayers.map(player => {
                        const progress = player.id ? playerProgress[player.id] : undefined;
                        if (!progress) return null;

                        return (
                          <div
                            key={progress.id}
                            className={`p-4 rounded-lg border-l-4 ${
                              progress.status === 'completed' ? 'border-green-500 bg-green-50' :
                              progress.status === 'failed' ? 'border-red-500 bg-red-50' :
                              progress.status === 'correct_step' ? 'border-blue-500 bg-blue-50' :
                              'border-gray-300 bg-gray-50'
                            }`}
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                              <span className="font-semibold text-gray-800">{progress.nickname}</span>
                              <span className={`text-xs font-medium px-3 py-1 rounded-full inline-flex items-center justify-center ${
                                progress.status === 'completed' ? 'bg-green-200 text-green-700' :
                                progress.status === 'failed' ? 'bg-red-200 text-red-700' :
                                progress.status === 'correct_step' ? 'bg-blue-200 text-blue-700' :
                                progress.status === 'solving' ? 'bg-yellow-200 text-yellow-700' : 
                                'bg-gray-200 text-gray-700'
                              }`}>
                                {progress.status === 'waiting' ? 'Esperando 1ra jugada' :
                                 progress.status === 'solving' ? `ERROR :() (${progress.lastAttemptedMove || 'N/A'})` :
                                 progress.status === 'correct_step' ? `OK (${progress.lastAttemptedMove || 'N/A'})${progress.opponentMoveSAN ? ` | Op: ${progress.opponentMoveSAN}` : ''}` :
                                 progress.status === 'completed' ? `Completado (${(progress.time || 0).toFixed(1)}s)` :
                                 progress.status === 'failed' ? `Falló (${(progress.time || 0).toFixed(1)}s)` : progress.status}
                              </span>
                            </div>
                            {(progress.status === 'solving' || progress.status === 'correct_step' || progress.status === 'waiting') && puzzleLaunchedAt && (
                              <div className="text-xs text-gray-500 mt-2">
                                Tiempo: {((Date.now() - puzzleLaunchedAt) / 1000).toFixed(1)}s
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-gray-500 text-sm">
                      Esperando actividad de los jugadores para este problema.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;