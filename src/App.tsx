import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useActionState, useState } from 'react'

interface GameResponse {
  gameId: string
  constraints: Array<{
    attribute: string
    minCount: number
  }>
  attributeStatistics: {
    relativeFrequencies: Record<string, number>
    correlations: Record<string, Record<string, number>>
  }
}

interface DecisionResponse {
  status: 'running' | 'completed' | 'failed'
  admittedCount?: number
  rejectedCount?: number
  nextPerson?: {
    personIndex: number
    attributes: Record<string, boolean>
  } | null
  reason?: string
}

interface GameStatusResponse {
  game: {
    gameId: string
    playerName: string
    level: number
    scenario: string
    status: string
    startTime: string
    endTime: string | null
    finalScore: number | null
    admitted: number
    rejected: number
    personCount: number
  }
  constraints: Array<{
    attribute: string
    label: string
    current: number
    target: number
    percentage: number
    isComplete: boolean
    isOverTarget: boolean
  }>
  metrics: {
    capacityProgress: number
    acceptanceRate: number
    rejectionProgress: number
    rejectionsUntilLimit: number
    isNearRejectionLimit: boolean
  }
  occupancy: Record<string, any>
  lastUpdated: string
}

async function createGame(formData: FormData): Promise<GameResponse> {
  const playerId = formData.get('playerId') as string
  const scenario = formData.get('scenario') as string
  
  const response = await fetch(
    `https://berghain.challenges.listenlabs.ai/new-game?scenario=${scenario}&playerId=${playerId}`
  )
  
  if (!response.ok) {
    throw new Error('Failed to create game')
  }
  
  return response.json()
}

async function getGameStatus(gameId: string): Promise<GameStatusResponse> {
  const response = await fetch(`https://berghain.challenges.listenlabs.ai/api/game/${gameId}`)
  
  if (!response.ok) {
    throw new Error('Failed to get game status')
  }
  
  return response.json()
}

async function getPersonAndDecide(gameId: string, personIndex: number, accept?: boolean): Promise<DecisionResponse> {
  const url = new URL('https://berghain.challenges.listenlabs.ai/decide-and-next')
  url.searchParams.set('gameId', gameId)
  url.searchParams.set('personIndex', personIndex.toString())
  
  if (accept !== undefined) {
    url.searchParams.set('accept', accept.toString())
  }
  
  const response = await fetch(url.toString())
  
  if (!response.ok) {
    throw new Error('Failed to get person')
  }
  
  return response.json()
}

function GamePlay({ gameId, onBack }: { gameId: string, onBack: () => void }) {
  const [currentPersonIndex, setCurrentPersonIndex] = useState(0)
  const [decisions, setDecisions] = useState<Array<{ personIndex: number, accept: boolean }>>([])
  const queryClient = useQueryClient()

  const { data: gameStatus, isLoading: gameStatusLoading, error: gameStatusError } = useQuery({
    queryKey: ['gameStatus', gameId],
    queryFn: () => getGameStatus(gameId),
    refetchInterval: 5000,
  })

  const { data: gameState, isLoading, error, refetch } = useQuery({
    queryKey: ['person', gameId, currentPersonIndex],
    queryFn: () => {
      const lastDecision = decisions[decisions.length - 1]
      return getPersonAndDecide(gameId, currentPersonIndex, lastDecision?.accept)
    },
  })

  const decideMutation = useMutation({
    mutationFn: ({ accept }: { accept: boolean }) => {
      setDecisions(prev => [...prev, { personIndex: currentPersonIndex, accept }])
      setCurrentPersonIndex(prev => prev + 1)
      return getPersonAndDecide(gameId, currentPersonIndex, accept)
    },
    onSuccess: () => {
      refetch()
      queryClient.invalidateQueries({ queryKey: ['gameStatus', gameId] })
    }
  })

  if (gameStatusLoading || isLoading) return <div>Loading...</div>
  if (gameStatusError) return <div>Error loading game status: {gameStatusError.message}</div>
  if (error) return <div>Error: {error.message}</div>
  if (!gameState || !gameStatus) return <div>No data</div>

  if (gameState.status === 'completed') {
    return (
      <div>
        <h2>Game Completed!</h2>
        <p><strong>Admitted:</strong> {gameState.admittedCount || 0}</p>
        <p><strong>Rejected:</strong> {gameState.rejectedCount}</p>
        <button onClick={onBack}>Start New Game</button>
      </div>
    )
  }

  if (gameState.status === 'failed') {
    return (
      <div>
        <h2>Game Failed</h2>
        <p><strong>Reason:</strong> {gameState.reason}</p>
        <p><strong>Rejected:</strong> {gameState.rejectedCount}</p>
        <button onClick={onBack}>Start New Game</button>
      </div>
    )
  }

  if (!gameState.nextPerson) {
    return <div>No person data available</div>
  }

  return (
    <div>
      <h2>Game Status</h2>
      <div>
        <p><strong>Player:</strong> {gameStatus.game.playerName}</p>
        <p><strong>Scenario:</strong> {gameStatus.game.scenario}</p>
        <p><strong>Level:</strong> {gameStatus.game.level}</p>
        <p><strong>Status:</strong> {gameStatus.game.status}</p>
        <p><strong>Person Count:</strong> {gameStatus.game.personCount}</p>
      </div>

      <h3>Progress</h3>
      <div>
        <p><strong>Admitted:</strong> {gameStatus.game.admitted}</p>
        <p><strong>Rejected:</strong> {gameStatus.game.rejected}</p>
        <p><strong>Capacity Progress:</strong> {(gameStatus.metrics.capacityProgress * 100).toFixed(1)}%</p>
        <p><strong>Acceptance Rate:</strong> {(gameStatus.metrics.acceptanceRate * 100).toFixed(1)}%</p>
        <p><strong>Rejections Until Limit:</strong> {gameStatus.metrics.rejectionsUntilLimit}</p>
      </div>

      <h3>Constraints</h3>
      <ul>
        {gameStatus.constraints.map((constraint, index) => (
          <li key={index} style={{ color: constraint.isComplete ? 'green' : constraint.isOverTarget ? 'red' : 'black' }}>
            <strong>{constraint.label}:</strong> {constraint.current}/{constraint.target} ({constraint.percentage.toFixed(1)}%)
            {constraint.isComplete && ' ✓'}
            {constraint.isOverTarget && ' ⚠️'}
          </li>
        ))}
      </ul>

      <h2>Person #{gameState.nextPerson.personIndex}</h2>
      
      <div>
        <p><strong>Current Decision - Admitted:</strong> {gameState.admittedCount || 0}</p>
        <p><strong>Current Decision - Rejected:</strong> {gameState.rejectedCount || 0}</p>
      </div>

      <h3>Attributes</h3>
      <ul>
        {Object.entries(gameState.nextPerson.attributes).map(([attribute, hasAttribute]) => (
          <li key={attribute} style={{ color: hasAttribute ? 'green' : 'red' }}>
            <strong>{attribute}:</strong> {hasAttribute ? '✓' : '✗'}
          </li>
        ))}
      </ul>

      <div>
        <button 
          onClick={() => decideMutation.mutate({ accept: true })}
          disabled={decideMutation.isPending}
          style={{ marginRight: '10px', backgroundColor: 'green', color: 'white' }}
        >
          Accept
        </button>
        <button 
          onClick={() => decideMutation.mutate({ accept: false })}
          disabled={decideMutation.isPending}
          style={{ backgroundColor: 'red', color: 'white' }}
        >
          Reject
        </button>
      </div>

      {decideMutation.isPending && <p>Making decision...</p>}

      <div style={{ marginTop: '20px' }}>
        <button onClick={onBack}>Back to Game Setup</button>
      </div>
    </div>
  )
}

function App() {
  const [gameId, setGameId] = useState<string | null>(null)
  const [gameMode, setGameMode] = useState<'create' | 'join'>('create')

  const createMutation = useMutation({
    mutationFn: createGame,
  })

  const joinMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const gameId = formData.get('gameId') as string
      // Validate the game exists by fetching its status
      await getGameStatus(gameId)
      return { gameId }
    }
  })

  const [createState, createFormAction, createIsPending] = useActionState(
    async (previousState: any, formData: FormData) => {
      try {
        const result = await createMutation.mutateAsync(formData)
        setGameId(result.gameId)
        return { success: true, data: result }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
      }
    },
    null
  )

  const [joinState, joinFormAction, joinIsPending] = useActionState(
    async (previousState: any, formData: FormData) => {
      try {
        const result = await joinMutation.mutateAsync(formData)
        setGameId(result.gameId)
        return { success: true, data: result }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
      }
    },
    null
  )

  if (gameId) {
    return <GamePlay gameId={gameId} onBack={() => setGameId(null)} />
  }

  return (
    <div>
      <h1>Puzzle UI</h1>
      
      <div style={{ marginBottom: '20px' }}>
        <button 
          onClick={() => setGameMode('create')} 
          style={{ 
            marginRight: '10px', 
            backgroundColor: gameMode === 'create' ? '#007bff' : '#f8f9fa',
            color: gameMode === 'create' ? 'white' : 'black'
          }}
        >
          Create New Game
        </button>
        <button 
          onClick={() => setGameMode('join')}
          style={{ 
            backgroundColor: gameMode === 'join' ? '#007bff' : '#f8f9fa',
            color: gameMode === 'join' ? 'white' : 'black'
          }}
        >
          Join Existing Game
        </button>
      </div>

      {gameMode === 'create' && (
        <div>
          <h2>Create New Game</h2>
          <form action={createFormAction}>
            <label>
              Player UUID
              <input type="text" name="playerId" placeholder="Enter player UUID" required />
            </label>

            <fieldset>
              <legend>Select Scenario</legend>
              <label>
                <input type="radio" name="scenario" value="1" required />
                Scenario 1
              </label>
              <label>
                <input type="radio" name="scenario" value="2" />
                Scenario 2
              </label>
              <label>
                <input type="radio" name="scenario" value="3" />
                Scenario 3
              </label>
            </fieldset>

            <button type="submit" disabled={createIsPending}>
              {createIsPending ? 'Creating Game...' : 'Create Game'}
            </button>
          </form>

          {createState?.success && !gameId && (
            <div>
              <h2>Game Created Successfully!</h2>
              <p><strong>Game ID:</strong> {createState.data.gameId}</p>
              
              <h3>Constraints</h3>
              <ul>
                {createState.data.constraints.map((constraint, index) => (
                  <li key={index}>
                    <strong>{constraint.attribute}:</strong> minimum {constraint.minCount}
                  </li>
                ))}
              </ul>

              <h3>Attribute Statistics</h3>
              
              <h4>Relative Frequencies</h4>
              <ul>
                {Object.entries(createState.data.attributeStatistics.relativeFrequencies).map(([attribute, frequency]) => (
                  <li key={attribute}>
                    <strong>{attribute}:</strong> {(frequency * 100).toFixed(2)}%
                  </li>
                ))}
              </ul>

              <h4>Correlations</h4>
              {Object.entries(createState.data.attributeStatistics.correlations).map(([attribute, correlations]) => (
                <div key={attribute}>
                  <h5>{attribute}</h5>
                  <ul>
                    {Object.entries(correlations).map(([correlatedAttribute, correlation]) => (
                      <li key={correlatedAttribute}>
                        <strong>vs {correlatedAttribute}:</strong> {correlation.toFixed(4)}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {createState?.error && (
            <div style={{ color: 'red' }}>
              <strong>Error:</strong> {createState.error}
            </div>
          )}
        </div>
      )}

      {gameMode === 'join' && (
        <div>
          <h2>Join Existing Game</h2>
          <form action={joinFormAction}>
            <label>
              Game UUID
              <input 
                type="text" 
                name="gameId" 
                placeholder="Enter game UUID (e.g., 2bc1db04-95a4-43a8-831f-b4543d77104d)" 
                required 
              />
            </label>

            <button type="submit" disabled={joinIsPending}>
              {joinIsPending ? 'Joining Game...' : 'Join Game'}
            </button>
          </form>

          {joinState?.success && !gameId && (
            <div style={{ color: 'green' }}>
              <strong>Game found! Redirecting...</strong>
            </div>
          )}

          {joinState?.error && (
            <div style={{ color: 'red' }}>
              <strong>Error:</strong> {joinState.error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default App
