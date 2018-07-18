import matplotlib.pyplot as plt
from matplotlib import colors
import numpy as np
import web3


# data = np.random.rand(10, 10) * 20
data_p1 = np.zeros((10, 10))
data_p2 = np.zeros((10, 10))

# create discrete colormap
cmap = colors.ListedColormap(['white', 'blue'])
bounds = [0,10,20]
norm = colors.BoundaryNorm(bounds, cmap.N)

fig, ax = plt.subplots()
grid_p1 = ax.imshow(data_p1, cmap=cmap, norm=norm)

# draw gridlines
ax.grid(which='major', axis='both', linestyle='-', color='k', linewidth=2)
ax.set_xticks(np.arange(-.5, 10, 1));
ax.set_yticks(np.arange(-.5, 10, 1));

fig1, ax1 = plt.subplots()
grid_p2 = ax1.imshow(data_p2, cmap=cmap, norm=norm)

# draw gridlines
ax1.grid(which='major', axis='both', linestyle='-', color='k', linewidth=2)
ax1.set_xticks(np.arange(-.5, 10, 1));
ax1.set_yticks(np.arange(-.5, 10, 1));

def set_data(i, j, val, b, data):
    data[i][j] = val
    b.set_data(data)
    plt.pause(0.5)

for i in range(10):
    set_data(4, 4, np.random.rand() * 20, grid_p1, data_p1)
    set_data(1, 2, np.random.rand() * 20, grid_p2, data_p2)

# set_data(2, 3, np.random.rand() * 20, grid1)
plt.show()
